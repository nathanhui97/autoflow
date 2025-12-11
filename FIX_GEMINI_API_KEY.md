# Fix Gemini API Key Issue

## Problem
The Gemini API key is returning 403 errors: "Your API key was reported as leaked. Please use another API key."

## Solution Steps

### 1. Get a New Gemini API Key

**Option A: Google AI Studio (Easiest)**
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key" or "Get API Key"
4. Copy the new API key (starts with `AIza...`)

**Option B: Google Cloud Console**
1. Go to https://console.cloud.google.com/
2. Navigate to **APIs & Services** > **Credentials**
3. Click **+ Create Credentials** > **API key**
4. Copy the new API key

### 2. Update Supabase Secret

Run this command (replace `YOUR_NEW_API_KEY` with your actual key):

```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"
npx supabase secrets set GEMINI_API_KEY=YOUR_NEW_API_KEY
```

**Example (replace with your actual key):**
```bash
npx supabase secrets set GEMINI_API_KEY=YOUR_ACTUAL_API_KEY_HERE
```

### 3. Verify the Secret is Set

```bash
npx supabase secrets list
```

You should see `GEMINI_API_KEY` in the list.

### 4. Test the Function

After updating the key, test variable detection again. The API calls should now work.

### 5. Security Best Practices

**Important:** The old API key in `deploy-edge-function.sh` is hardcoded and has been leaked. 

**DO NOT:**
- Commit API keys to git
- Hardcode API keys in scripts
- Share API keys publicly

**DO:**
- Use Supabase secrets (which you're already doing)
- Remove hardcoded keys from scripts
- Restrict the API key in Google Cloud Console:
  - Go to the API key settings
  - Under "API restrictions", select "Restrict key"
  - Choose "Generative Language API"
  - Under "Application restrictions", you can add IP restrictions if needed

### 6. Clean Up Old Key (Optional)

If you want to remove the hardcoded key from the deployment script:

1. Edit `deploy-edge-function.sh`
2. Remove or comment out line 21 (the hardcoded API key)
3. The script will still work because the secret is set in Supabase

## Verification

After updating the key, check the Supabase function logs:
1. Go to https://supabase.com/dashboard/project/jfboagngbpzollcipewh/functions/detect_variables/logs
2. Trigger variable detection
3. You should see successful API calls instead of 403 errors

## Troubleshooting

If you still get 403 errors:
1. Make sure the new API key is correct (starts with `AIza`)
2. Verify the secret was set: `npx supabase secrets list`
3. Check that the Generative Language API is enabled in your Google Cloud project
4. Wait a few minutes after setting the secret (sometimes there's a delay)
