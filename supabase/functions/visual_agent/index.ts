/**
 * Supabase Edge Function: visual_agent
 * 
 * The AI brain for the agent architecture.
 * Receives the current page state and decides what action to take.
 * 
 * This is the single point of AI decision-making.
 * The extension just executes whatever action this returns.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v1.0.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

console.log('visual_agent Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'navigate' | 'other';
  targetText?: string;
  value?: string;
  completed: boolean;
}

interface HistoryEntry {
  stepNumber: number;
  action: string;
  params: Record<string, unknown>;
  result: 'success' | 'failed' | 'pending';
}

interface AgentRequest {
  screenshot: string;
  goal: string;
  hints: AgentHint[];
  currentHintIndex: number;
  history: HistoryEntry[];
  pageContext: {
    url: string;
    title: string;
    viewportSize: { width: number; height: number };
  };
  referenceScreenshot?: string;
  referenceClickPoint?: { x: number; y: number };
}

interface SemanticTarget {
  // Text matching
  text?: string;
  textMatch?: 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'fuzzy';
  
  // Element identity
  role?: string;
  tagName?: string;
  ariaLabel?: string;
  testId?: string;
  title?: string;
  placeholder?: string;
  name?: string;
  
  // Context
  nearbyText?: string[];
  region?: string;
  parentText?: string;
  
  // Disambiguation
  index?: number;
  className?: string;
  
  // Timing
  waitTimeout?: number;
  
  // Canvas/Grid fallback (for Excel, Airtable)
  fallbackCoordinates?: { x: number; y: number };
}

interface AgentResponse {
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';
  params: {
    // For semantic click
    target?: SemanticTarget;
    // For type
    text?: string;
    // For scroll
    direction?: string;
    amount?: number;
    // For navigate
    url?: string;
    // For wait
    duration?: number;
    // For fail
    reason?: string;
  };
  reasoning: string;
  confidence: number;
  hintStepIndex?: number;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    console.log('visual_agent', VERSION, 'received request');
    const payload: AgentRequest = await req.json();
    
    console.log('Goal:', payload.goal);
    console.log('Current hint index:', payload.currentHintIndex);
    console.log('History length:', payload.history.length);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build prompt
    const prompt = buildAgentPrompt(payload);
    
    // Build Gemini request
    const geminiRequest = buildGeminiRequest(prompt, payload);

    // Call Gemini API
    console.log('Calling Gemini API...');
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    console.log('Gemini response status:', geminiResponse.status);

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const responseText = await geminiResponse.text();
    console.log('Raw Gemini response length:', responseText.length);
    console.log('Raw Gemini response preview:', responseText.substring(0, 200));
    
    const geminiData = JSON.parse(responseText);
    const result = parseAgentResponse(geminiData, payload);

    console.log('Agent decision:', result.action, result.params);
    console.log('Reasoning:', result.reasoning);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in visual_agent:', error);
    return new Response(
      JSON.stringify({
        action: 'fail',
        params: { reason: error instanceof Error ? error.message : 'Unknown error' },
        reasoning: 'Error occurred in agent',
        confidence: 0,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

// ============================================================================
// Prompt Building
// ============================================================================

function buildAgentPrompt(payload: AgentRequest): string {
  const { goal, hints, currentHintIndex, history, pageContext, referenceClickPoint } = payload;
  const parts: string[] = [];

  // Header
  parts.push('# AI Web Automation Agent');
  parts.push('');
  parts.push('You are an AI agent automating a web workflow. You observe the current page and decide what action to take next.');
  parts.push('');

  // Goal
  parts.push('## Your Goal');
  parts.push(goal);
  parts.push('');

  // Hints from recording
  parts.push('## Workflow Hints (from recording)');
  parts.push('These are the steps recorded by the user. Use them as guidance, but adapt if the page looks different.');
  parts.push('');
  
  hints.forEach((hint, i) => {
    const status = hint.completed ? '✓' : (i === currentHintIndex ? '→' : '○');
    const isCurrent = i === currentHintIndex ? ' **<-- CURRENT**' : '';
    parts.push(`${status} Step ${hint.stepNumber}: ${hint.description}${isCurrent}`);
    if (hint.actionType === 'type' && hint.value) {
      parts.push(`   Value to type: "${hint.value}"`);
    }
  });
  parts.push('');

  // Action history
  if (history.length > 0) {
    parts.push('## Recent Actions Taken');
    history.slice(-5).forEach(h => {
      const resultIcon = h.result === 'success' ? '✓' : '✗';
      parts.push(`${resultIcon} ${h.action}(${JSON.stringify(h.params)}) - ${h.result}`);
    });
    parts.push('');
  }

  // Current page context
  parts.push('## Current Page');
  parts.push(`- URL: ${pageContext.url}`);
  parts.push(`- Title: ${pageContext.title}`);
  parts.push(`- Viewport: ${pageContext.viewportSize.width}x${pageContext.viewportSize.height}`);
  parts.push('');

  // Reference click point if available
  if (referenceClickPoint) {
    parts.push('## Reference Information');
    parts.push(`The recorded click was at approximately (${referenceClickPoint.x}, ${referenceClickPoint.y}).`);
    parts.push('Use this as a hint, but find the actual element in the current screenshot.');
    parts.push('');
  }

  // Instructions
  parts.push('## Available Actions');
  parts.push('- `click(target)`: Click an element by describing it semantically');
  parts.push('- `type(text)`: Type text into the focused input field');
  parts.push('- `scroll(direction, amount)`: Scroll the page (direction: up/down/left/right)');
  parts.push('- `navigate(url)`: Navigate to a specific URL');
  parts.push('- `wait(duration)`: Wait for specified milliseconds');
  parts.push('- `done()`: Workflow is complete');
  parts.push('- `fail(reason)`: Cannot continue (explain why)');
  parts.push('');

  // Decision process
  parts.push('## Your Task');
  parts.push('');
  parts.push('1. Look at the current screenshot (IMAGE 1)');
  if (payload.referenceScreenshot) {
    parts.push('2. Compare with reference screenshot (IMAGE 2) which shows what the user saw during recording');
  }
  parts.push('3. Identify what action to take based on the current hint');
  parts.push('4. If the hint is a CLICK: Describe the target element semantically (text, role, region)');
  parts.push('5. If the hint is TYPE: Make sure an input is focused, then return type action');
  parts.push('6. If all hints are completed: Return done()');
  parts.push('7. If stuck or element not visible: Return wait() or scroll() to reveal it');
  parts.push('');

  // Special guidance
  parts.push('## Important Notes');
  parts.push('- Describe elements by their VISIBLE TEXT and ROLE, not coordinates');
  parts.push('- Specify the region (header, sidebar, modal, main) to narrow down the search');
  parts.push('- If a modal or popup blocks the target, handle it first');
  parts.push('- Before typing, ensure an input field is focused (may need to click first)');
  parts.push('- If element is below the fold, scroll down first');
  parts.push('- Salesforce/Lightning apps may have loading spinners - wait if page is loading');
  parts.push('');

  // Response format
  parts.push('## Response Format');
  parts.push('Return ONLY valid JSON. For CLICK actions, use semantic targeting:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "click",');
  parts.push('  "params": {');
  parts.push('    "target": {');
  parts.push('      "text": "New",');
  parts.push('      "role": "button",');
  parts.push('      "region": "header"');
  parts.push('    }');
  parts.push('  },');
  parts.push('  "reasoning": "Clicking the New button in the header to create a new account",');
  parts.push('  "confidence": 0.95,');
  parts.push('  "hintStepIndex": 0');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For type action:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "type",');
  parts.push('  "params": { "text": "Hello World" },');
  parts.push('  "reasoning": "Typing into the focused Account Name field",');
  parts.push('  "confidence": 0.9,');
  parts.push('  "hintStepIndex": 1');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For navigate action:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "navigate",');
  parts.push('  "params": { "url": "https://example.com/page" },');
  parts.push('  "reasoning": "Navigating directly to the target page",');
  parts.push('  "confidence": 1.0,');
  parts.push('  "hintStepIndex": 0');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For done action (all steps complete):');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "done",');
  parts.push('  "params": {},');
  parts.push('  "reasoning": "All workflow steps have been completed successfully",');
  parts.push('  "confidence": 1.0');
  parts.push('}');
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Gemini Request Building
// ============================================================================

function buildGeminiRequest(prompt: string, payload: AgentRequest): any {
  const parts: any[] = [{ text: prompt }];

  // Add current screenshot
  parts.push({
    text: '\n--- IMAGE 1: CURRENT PAGE STATE ---\n'
  });
  
  const screenshotBase64 = extractBase64Data(payload.screenshot);
  const mimeType = detectMimeType(payload.screenshot);
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: screenshotBase64
    }
  });

  // Add reference screenshot if provided
  if (payload.referenceScreenshot) {
    parts.push({
      text: '\n--- IMAGE 2: REFERENCE FROM RECORDING ---\n'
    });
    parts.push({
      text: 'This shows what the page looked like during recording. Use it to identify the target element.\n'
    });
    
    const refBase64 = extractBase64Data(payload.referenceScreenshot);
    const refMime = detectMimeType(payload.referenceScreenshot);
    parts.push({
      inline_data: {
        mime_type: refMime,
        data: refBase64
      }
    });
  }

  return {
    contents: [{
      parts,
      role: 'user'
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['click', 'type', 'scroll', 'navigate', 'wait', 'done', 'fail']
          },
          params: {
            type: 'object',
            properties: {
              target: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  textMatch: { 
                    type: 'string',
                    enum: ['exact', 'contains', 'startsWith', 'endsWith', 'fuzzy']
                  },
                  role: { type: 'string' },
                  tagName: { type: 'string' },
                  ariaLabel: { type: 'string' },
                  testId: { type: 'string' },
                  title: { type: 'string' },
                  placeholder: { type: 'string' },
                  name: { type: 'string' },
                  nearbyText: { 
                    type: 'array',
                    items: { type: 'string' }
                  },
                  region: { type: 'string' },
                  parentText: { type: 'string' },
                  index: { type: 'number' },
                  className: { type: 'string' },
                  waitTimeout: { type: 'number' },
                  fallbackCoordinates: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' }
                    }
                  }
                }
              },
              text: { type: 'string' },
              direction: { type: 'string' },
              amount: { type: 'number' },
              url: { type: 'string' },
              duration: { type: 'number' },
              reason: { type: 'string' }
            }
          },
          reasoning: { type: 'string' },
          confidence: { type: 'number' },
          hintStepIndex: { type: 'number' }
        },
        required: ['action', 'params', 'reasoning', 'confidence']
      }
    },
    systemInstruction: {
      parts: [{
        text: `You are a web automation AI agent. You must ALWAYS respond with valid JSON only.

CRITICAL: Your response must be ONLY a JSON object. No markdown, no code blocks, no explanations.

For CLICK actions, describe the target element semantically (text, role, region), NOT by coordinates.

Required JSON format:
{
  "action": "click" | "type" | "scroll" | "navigate" | "wait" | "done" | "fail",
  "params": { ... },
  "reasoning": "string",
  "confidence": 0.0-1.0,
  "hintStepIndex": number (optional)
}

Examples:
{"action":"click","params":{"target":{"text":"New","role":"button","region":"header"}},"reasoning":"Clicking New button in header","confidence":0.9,"hintStepIndex":0}
{"action":"type","params":{"text":"Hello"},"reasoning":"Typing into field","confidence":0.85,"hintStepIndex":1}
{"action":"navigate","params":{"url":"https://example.com"},"reasoning":"Direct navigation","confidence":1.0,"hintStepIndex":0}
{"action":"done","params":{},"reasoning":"All steps complete","confidence":1.0}`
      }]
    }
  };
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseAgentResponse(geminiData: any, payload: AgentRequest): AgentResponse {
  try {
    // Check if Gemini returned an error
    if (geminiData.error) {
      console.error('Gemini API error:', geminiData.error);
      return createFailResponse(`Gemini error: ${geminiData.error.message || 'Unknown error'}`);
    }

    // Log the full geminiData structure for debugging
    console.log('Full geminiData structure:', JSON.stringify(geminiData, null, 2).substring(0, 1000));
    
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Extracted text length:', text.length);
    console.log('Extracted text preview:', text.substring(0, 500));

    if (!text) {
      console.error('Empty response from Gemini');
      return createFailResponse('Empty response from AI');
    }

    // Extract JSON
    let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      jsonMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    }
    if (!jsonMatch) {
      jsonMatch = text.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      console.error('No JSON found in response. Full text:', text);
      return createFailResponse('No valid JSON in AI response. AI returned plain text instead of JSON.');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    console.log('Extracted JSON string:', jsonStr.substring(0, 300));
    
    const parsed = JSON.parse(jsonStr);
    console.log('Parsed object:', JSON.stringify(parsed, null, 2));

    // Validate action
    const validActions = ['click', 'type', 'scroll', 'navigate', 'wait', 'done', 'fail'];
    if (!validActions.includes(parsed.action)) {
      console.error('Invalid action:', parsed.action);
      return createFailResponse(`Invalid action: ${parsed.action}`);
    }

    // Validate click action has target (semantic) or coordinates (fallback)
    if (parsed.action === 'click') {
      const hasTarget = parsed.params?.target && typeof parsed.params.target === 'object';
      const hasCoordinates = typeof parsed.params?.x === 'number' && typeof parsed.params?.y === 'number';
      
      if (!hasTarget && !hasCoordinates) {
        console.error('Invalid click action - needs target or coordinates:', parsed.params);
        return createFailResponse('Click action missing semantic target or coordinates');
      }
      
      console.log('Click action validated:', hasTarget ? 'has semantic target' : 'has coordinates');
    }

    // Validate type text
    if (parsed.action === 'type') {
      const text = parsed.params?.text;
      if (typeof text !== 'string') {
        console.error('Invalid type text:', text);
        return createFailResponse('Type action missing text parameter');
      }
    }

    return {
      action: parsed.action,
      params: parsed.params || {},
      reasoning: parsed.reasoning || 'AI decision',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      hintStepIndex: parsed.hintStepIndex,
    };
  } catch (error) {
    console.error('Error parsing response:', error);
    return createFailResponse('Failed to parse AI response');
  }
}

function createFailResponse(reason: string): AgentResponse {
  return {
    action: 'fail',
    params: { reason },
    reasoning: reason,
    confidence: 0,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

function detectMimeType(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'image/png';
  if (dataUrl.includes('image/jpeg')) return 'image/jpeg';
  if (dataUrl.includes('image/webp')) return 'image/webp';
  return 'image/png';
}

