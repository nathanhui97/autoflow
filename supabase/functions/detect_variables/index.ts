/**
 * Supabase Edge Function: detect_variables
 * Analyzes workflow step snapshots using Gemini Vision API to determine
 * which fields should be parameterized as variables for workflow execution.
 * 
 * Focuses primarily on INPUT/TEXTAREA steps, with selective CLICK step analysis
 * for selectable options (dropdowns, radio buttons).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface StepMetadata {
  stepIndex: number;
  stepId: string;
  stepType: 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD';
  value?: string;
  label?: string;
  inputType?: string;
  elementRole?: string;
  elementTag?: string;
  placeholder?: string;
  isSelectableOption?: boolean; // True for dropdowns, radio buttons, etc.
  isDropdown?: boolean;         // Whether this is a dropdown/select
  dropdownOptions?: string[];   // Available options in dropdown (if known from DOM)
}

interface StepForAnalysis {
  metadata: StepMetadata;
  beforeSnapshot?: string; // Base64 image
  afterSnapshot?: string;  // Base64 image
}

interface DetectVariablesRequest {
  steps: StepForAnalysis[];
  pageContext?: {
    url: string;
    title: string;
    pageType?: string;
  };
}

interface VariableDefinition {
  stepIndex: number;
  stepId: string;
  fieldName: string;
  fieldLabel?: string;
  variableName: string;
  defaultValue: string;
  inputType?: string;
  isVariable: boolean;
  confidence: number;
  reasoning?: string;
  options?: string[];      // Available options for dropdown/select variables
  isDropdown?: boolean;    // Whether this is a dropdown/select variable
}

interface DetectVariablesResponse {
  variables: VariableDefinition[];
  analysisCount: number;
  error?: string;
}

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
    const payload: DetectVariablesRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.steps || payload.steps.length === 0) {
      return new Response(JSON.stringify({ variables: [], analysisCount: 0 }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Initialize Supabase client for caching
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check cache first
    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for detect_variables:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Analyze each step with snapshots
    const variables: VariableDefinition[] = [];
    let analysisCount = 0;

    for (const step of payload.steps) {
      // Skip steps without snapshots
      if (!step.afterSnapshot) {
        continue;
      }

      analysisCount++;

      // Analyze this step
      const result = await analyzeStep(step, payload.pageContext);
      
      if (result && result.isVariable) {
        variables.push(result);
      }
    }

    const response: DetectVariablesResponse = {
      variables,
      analysisCount,
    };

    // Cache the result (30 minute TTL - variables don't change often)
    await saveToCache(supabase, cacheKey, response, 30 * 60);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in detect_variables:', error);
    return new Response(
      JSON.stringify({
        variables: [],
        analysisCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
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

/**
 * Analyze a single step to determine if it contains a variable
 */
async function analyzeStep(
  step: StepForAnalysis,
  pageContext?: { url: string; title: string; pageType?: string }
): Promise<VariableDefinition | null> {
  const { metadata, beforeSnapshot, afterSnapshot } = step;

  // Build the prompt based on step type
  const prompt = buildVariableDetectionPrompt(metadata, pageContext);

  // Build Gemini API request with screenshots
  const parts: any[] = [{ text: prompt }];

  // Add before snapshot if available (helps see what changed)
  if (beforeSnapshot) {
    const beforeBase64 = extractBase64Data(beforeSnapshot);
    parts.push({
      text: '\n\nBEFORE Screenshot (state before user action):'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: beforeBase64
      }
    });
  }

  // Add after snapshot (required)
  if (afterSnapshot) {
    const afterBase64 = extractBase64Data(afterSnapshot);
    parts.push({
      text: beforeSnapshot ? '\n\nAFTER Screenshot (state after user action):' : '\n\nScreenshot of the element/action:'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: afterBase64
      }
    });
  }

  const geminiRequest = {
    contents: [{
      parts
    }],
    generationConfig: {
      temperature: 0.2, // Low temperature for consistent classification
      maxOutputTokens: 1024,
    }
  };

  try {
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`Gemini API error for step ${metadata.stepIndex}:`, errorText);
      return null;
    }

    const geminiData = await geminiResponse.json();
    return parseVariableResponse(geminiData, metadata);
  } catch (error) {
    console.error(`Error analyzing step ${metadata.stepIndex}:`, error);
    return null;
  }
}

/**
 * Build prompt for variable detection based on step type
 */
function buildVariableDetectionPrompt(
  metadata: StepMetadata,
  pageContext?: { url: string; title: string; pageType?: string }
): string {
  let prompt = `TASK: Analyze this workflow step to determine if the user-entered value should be a VARIABLE (parameterized, different each execution) or STATIC (same value each time).

`;

  if (pageContext) {
    prompt += `Page Context:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
${pageContext.pageType ? `- Page Type: ${pageContext.pageType}` : ''}

`;
  }

  prompt += `Step Information:
- Step Type: ${metadata.stepType}
- Value Entered: "${metadata.value || ''}"
${metadata.label ? `- Field Label: "${metadata.label}"` : ''}
${metadata.inputType ? `- Input Type: ${metadata.inputType}` : ''}
${metadata.placeholder ? `- Placeholder: "${metadata.placeholder}"` : ''}
${metadata.elementRole ? `- Element Role: ${metadata.elementRole}` : ''}
${metadata.elementTag ? `- Element Tag: ${metadata.elementTag}` : ''}

`;

  if (metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD') {
    prompt += `ANALYZE THIS INPUT FIELD:

Compare the before/after screenshots (if provided) to understand what the user entered.

A value is likely a VARIABLE if:
- It's user-specific data (name, email, phone, address)
- It's a credential (username, password)
- It's a date that would change (appointment date, deadline)
- It's a search query or filter value
- It's a unique identifier (ID, code, reference number)
- The field is empty before and filled after with user-entered text

A value is likely STATIC if:
- It's a system default or placeholder
- It's a fixed configuration value
- It looks like test/demo data that wouldn't change
- It's pre-filled by the system

`;
  } else if (metadata.stepType === 'CLICK' && metadata.isSelectableOption) {
    if (metadata.isDropdown) {
      prompt += `ANALYZE THIS DROPDOWN SELECTION:

This is a click on a dropdown/select menu option.
Compare the before/after screenshots to see what option was selected.

${metadata.dropdownOptions && metadata.dropdownOptions.length > 0 
  ? `KNOWN OPTIONS FROM DOM: ${metadata.dropdownOptions.join(', ')}\n\n` 
  : 'EXTRACT ALL AVAILABLE OPTIONS: Look at the dropdown menu in the screenshot and list ALL available options.\n\n'}

A selection is likely a VARIABLE if:
- It's a user preference that could change (e.g., "Select Plan: Pro")
- It's a category selection that varies per use case
- It's a filter or sort option
- The selection represents user choice rather than navigation

A selection is likely STATIC if:
- It's a navigation button (Next, Submit, Continue)
- It's a fixed system setting
- It's enabling/disabling a feature that's always the same

`;
    } else {
      prompt += `ANALYZE THIS SELECTION:

This is a click on a selectable option (radio button, checkbox).
Compare the before/after screenshots to see what option was selected.

A selection is likely a VARIABLE if:
- It's a user preference that could change (e.g., "Select Plan: Pro")
- It's a category selection that varies per use case
- It's a filter or sort option
- The selection represents user choice rather than navigation

A selection is likely STATIC if:
- It's a navigation button (Next, Submit, Continue)
- It's a fixed system setting
- It's enabling/disabling a feature that's always the same

`;
    }
  }

  prompt += `RESPOND WITH JSON:
{
  "isVariable": <true or false>,
  "confidence": <0.0 to 1.0>,
  "fieldName": "<human-readable field name from visual analysis>",
  "variableName": "<camelCase variable name suggestion>",
  "reasoning": "<brief explanation of why this is/isn't a variable>"${metadata.isDropdown ? ',
  "options": ["<option1>", "<option2>", ...] // ALL available dropdown options from the screenshot' : ''}
}

IMPORTANT:
- Focus on what a human would recognize as "user data" vs "system data"
- Higher confidence (0.8+) for clear cases like email, password, name fields
- Medium confidence (0.5-0.8) for ambiguous cases
- Lower confidence (<0.5) if unsure - lean toward NOT marking as variable${metadata.isDropdown ? `
- For dropdowns: Extract ALL visible options from the dropdown menu in the screenshot
- Include the currently selected option in the options array' : ''}`;

  return prompt;
}

/**
 * Parse Gemini response into VariableDefinition
 */
function parseVariableResponse(
  geminiData: any,
  metadata: StepMetadata
): VariableDefinition | null {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in Gemini response for step', metadata.stepIndex);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Only return if marked as variable
    const isVariable = parsed.isVariable === true;
    const confidence = parseFloat(parsed.confidence) || 0;

    const result: VariableDefinition = {
      stepIndex: metadata.stepIndex,
      stepId: metadata.stepId,
      fieldName: parsed.fieldName || metadata.label || 'Unknown Field',
      fieldLabel: metadata.label,
      variableName: parsed.variableName || generateVariableName(parsed.fieldName || metadata.label),
      defaultValue: metadata.value || '',
      inputType: metadata.inputType,
      isVariable,
      confidence,
      reasoning: parsed.reasoning,
    };

    // Add dropdown-specific fields
    if (metadata.isDropdown) {
      result.isDropdown = true;
      // Use AI-extracted options if available, otherwise use DOM options
      if (parsed.options && Array.isArray(parsed.options) && parsed.options.length > 0) {
        result.options = parsed.options;
      } else if (metadata.dropdownOptions && metadata.dropdownOptions.length > 0) {
        result.options = metadata.dropdownOptions;
      }
    }

    return result;
  } catch (error) {
    console.error('Error parsing variable response:', error);
    return null;
  }
}

/**
 * Generate a camelCase variable name from a field name
 */
function generateVariableName(fieldName: string): string {
  if (!fieldName) return 'field';
  
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, index) => 
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * Generate cache key for the request
 */
function generateCacheKey(payload: DetectVariablesRequest): string {
  // Create a hash based on step metadata and page context
  const keyData = {
    type: 'detect_variables',
    stepCount: payload.steps.length,
    stepIds: payload.steps.map(s => s.metadata.stepId).join(','),
    pageUrl: payload.pageContext?.url?.substring(0, 100),
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `detect_variables_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache for existing result
 */
async function checkCache(
  supabase: any,
  cacheKey: string
): Promise<DetectVariablesResponse | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as DetectVariablesResponse;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save result to cache
 */
async function saveToCache(
  supabase: any,
  cacheKey: string,
  result: DetectVariablesResponse,
  ttlSeconds: number = 1800
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await supabase
      .from('ai_cache')
      .upsert({
        cache_key: cacheKey,
        response_data: result,
        expires_at: expiresAt.toISOString(),
      });
  } catch (e) {
    console.error('Cache save error:', e);
  }
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}
