/**
 * Supabase Edge Function: generate_step_description
 * Generates natural language descriptions for workflow steps using Gemini API
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface StepDescriptionPayload {
  step: {
    type: string;
    payload: {
      selector?: string;
      label?: string;
      value?: string;
      elementText?: string;
      url?: string;
      elementRole?: string;
      visualSnapshot?: {
        elementSnippet?: string; // Base64 data URL
        viewport?: string; // Base64 data URL
      };
      context?: {
        container?: { text?: string; type?: string };
        parent?: { text?: string };
        buttonContext?: { label?: string; section?: string };
        decisionSpace?: {
          type: string;
          options: string[];
          selectedIndex: number;
          selectedText: string;
        };
      };
    };
  };
}

interface StepDescriptionResult {
  description: string;
  confidence: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Parse request
    const payload: StepDescriptionPayload = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Log what we're receiving
    console.log('Step type:', payload.step.type);
    console.log('Has visual snapshot:', !!payload.step.payload.visualSnapshot?.elementSnippet);
    console.log('Has decisionSpace:', !!payload.step.payload.context?.decisionSpace);
    console.log('Element text:', payload.step.payload.elementText);
    console.log('Label:', payload.step.payload.label);
    
    // Build prompt from step
    const prompt = buildPrompt(payload);

    // Build Gemini API request with image support
    const parts: any[] = [{ text: prompt }];
    
    // Add visual snapshot if available (Gemini supports base64 images)
    if (payload.step.payload.visualSnapshot?.elementSnippet) {
      const imageData = payload.step.payload.visualSnapshot.elementSnippet;
      // Extract base64 data (remove data:image/png;base64, prefix if present)
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      
      parts.push({
        inline_data: {
          mime_type: imageData.includes('jpeg') ? 'image/jpeg' : 'image/png',
          data: base64Data
        }
      });
      console.log('Including element snapshot in description generation (size:', base64Data.length, 'chars)');
    } else {
      console.warn('No visual snapshot available - descriptions may be less accurate');
    }

    const geminiRequest: any = {
      contents: [{
        parts: parts
      }]
    };

    // Call Gemini API
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const result = parseGeminiResponse(geminiData, payload);

    // Cache the result
    await saveToCache(supabase, cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in generate_step_description:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        description: 'Action performed',
        confidence: 0
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
 * Generate cache key from payload
 * Include visual snapshot hash to differentiate similar steps
 */
function generateCacheKey(payload: StepDescriptionPayload): string {
  const keyData = {
    type: 'step_description',
    stepType: payload.step.type,
    selector: payload.step.payload.selector,
    label: payload.step.payload.label,
    value: payload.step.payload.value,
    elementText: payload.step.payload.elementText,
    // Include decisionSpace to differentiate dropdown selections
    selectedText: payload.step.payload.context?.decisionSpace?.selectedText,
    // Include snapshot hash (first 100 chars) to differentiate visually different elements
    snapshotHash: payload.step.payload.visualSnapshot?.elementSnippet?.substring(0, 100),
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `step_description_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<StepDescriptionResult | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as StepDescriptionResult;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save to cache
 */
async function saveToCache(supabase: any, cacheKey: string, result: StepDescriptionResult): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days TTL

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
 * Build prompt from step
 */
function buildPrompt(payload: StepDescriptionPayload): string {
  const step = payload.step;
  let prompt = `Generate a clear, concise natural language description for this workflow step.\n\n`;
  
  prompt += `Step Type: ${step.type}\n\n`;
  
  if (step.type === 'CLICK') {
    prompt += `Context:\n`;
    if (step.payload.label) prompt += `- Label: "${step.payload.label}"\n`;
    if (step.payload.elementText) prompt += `- Element Text: "${step.payload.elementText}"\n`;
    if (step.payload.elementRole) prompt += `- Role: "${step.payload.elementRole}"\n`;
    if (step.payload.context?.container?.text) {
      prompt += `- Container: "${step.payload.context.container.text}" (${step.payload.context.container.type || 'container'})\n`;
    }
    if (step.payload.context?.buttonContext?.section) {
      prompt += `- Section: "${step.payload.context.buttonContext.section}"\n`;
    }
    if (step.payload.context?.buttonContext?.label) {
      prompt += `- Button Label: "${step.payload.context.buttonContext.label}"\n`;
    }
    
    // Check for dropdown/menu selection
    if (step.payload.context?.decisionSpace) {
      const ds = step.payload.context.decisionSpace;
      prompt += `- Dropdown/Menu Selection:\n`;
      prompt += `  - Selected: "${ds.selectedText}" (option ${ds.selectedIndex + 1} of ${ds.options.length})\n`;
      prompt += `  - Available options: ${ds.options.slice(0, 5).join(', ')}${ds.options.length > 5 ? '...' : ''}\n`;
    }
    
    // Mention visual snapshot if available
    if (step.payload.visualSnapshot?.elementSnippet) {
      prompt += `\nIMPORTANT: A visual snapshot of the clicked element is provided as an image above. Carefully examine it to:\n`;
      prompt += `1. Identify the EXACT UI element type (three-dot menu button, download icon, dropdown item, etc.)\n`;
      prompt += `2. Read any visible text or labels on the element\n`;
      prompt += `3. Understand the visual context (is it in a menu? toolbar? dropdown?)\n`;
      prompt += `4. Determine the specific action (download, export, settings, etc.)\n`;
      prompt += `\nDO NOT use generic descriptions. Use the visual snapshot to be SPECIFIC.\n`;
    } else {
      prompt += `\nNOTE: No visual snapshot available. Use the context information above to generate the description.\n`;
    }
    
    prompt += `\nGenerate a SPECIFIC, DISTINCTIVE description (5-15 words) that clearly identifies this action:\n`;
    prompt += `- For three-dot menus: "Click the three-dot menu button" or "Open the options menu"\n`;
    prompt += `- For dropdown items: "Click '[item name]' from the [menu name]" (e.g., "Click 'Download' from the export menu")\n`;
    prompt += `- For icons: "Click the [icon name] icon" (e.g., "Click the download icon", "Click the settings icon")\n`;
    prompt += `- For buttons: "Click the [button name] button" (e.g., "Click the download button")\n`;
    prompt += `- AVOID generic descriptions like "click on widget" or "click on element"\n`;
    prompt += `- Make it clear what specific action is being performed\n`;
  } else if (step.type === 'INPUT') {
    prompt += `Context:\n`;
    if (step.payload.label) prompt += `- Field Label: "${step.payload.label}"\n`;
    if (step.payload.value) prompt += `- Value Entered: "${step.payload.value.substring(0, 100)}"\n`;
    if (step.payload.context?.formCoordinates?.label) {
      prompt += `- Form Field: "${step.payload.context.formCoordinates.label}"\n`;
    }
    prompt += `\nGenerate a description like: "Enter [value] in [field name]" or "Type [value] into the [field] field"\n`;
  } else if (step.type === 'NAVIGATION') {
    prompt += `Context:\n`;
    if (step.payload.url) prompt += `- URL: ${step.payload.url}\n`;
    prompt += `\nGenerate a description like: "Navigate to [page name]" or "Go to [page/URL]"\n`;
  } else if (step.type === 'KEYBOARD') {
    prompt += `Context:\n`;
    if (step.payload.keyboardDetails?.key) {
      prompt += `- Key: ${step.payload.keyboardDetails.key}\n`;
    }
    prompt += `\nGenerate a description like: "Press [key]" or "Press [key] to [action]"\n`;
  }
  
  prompt += `\nReturn JSON with this exact structure:\n`;
  prompt += `{\n`;
  prompt += `  "description": "clear, concise description in 5-15 words",\n`;
  prompt += `  "confidence": 0.0-1.0\n`;
  prompt += `}\n\n`;
  prompt += `Only return valid JSON, no markdown formatting.`;

  return prompt;
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(geminiData: any, payload: StepDescriptionPayload): StepDescriptionResult {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    const result: StepDescriptionResult = {
      description: typeof parsed.description === 'string' ? parsed.description.trim() : 'Action performed',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return result;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    // Return fallback result
    return {
      description: 'Action performed',
      confidence: 0,
    };
  }
}
