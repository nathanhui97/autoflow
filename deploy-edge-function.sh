#!/bin/bash
# Deployment script for Supabase Edge Function
# Run this after: supabase login

set -e

echo "🚀 Deploying Edge Functions to Supabase..."

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "Installing Supabase CLI via npx..."
    npx supabase --version
fi

# Link to project (if not already linked)
echo "Linking to Supabase project..."
npx supabase link --project-ref jfboagngbpzollcipewh || echo "Already linked or login required"

# Set the Gemini API key secret (needed for both functions)
echo "Setting GEMINI_API_KEY secret..."
npx supabase secrets set GEMINI_API_KEY=AIzaSyBfLwmgunY7n9ckJYQKVYQ0_uhvc5SQoIM

# Deploy recover_element function
echo "Deploying recover_element function..."
npx supabase functions deploy recover_element

# Deploy validate_selector function
echo "Deploying validate_selector function..."
npx supabase functions deploy validate_selector

# Deploy generate_step_description function
echo "Deploying generate_step_description function..."
npx supabase functions deploy generate_step_description

echo "✅ Deployment complete!"
echo ""
echo "Deployed functions:"
echo "  - recover_element"
echo "  - validate_selector"
echo "  - generate_step_description"
echo ""
echo "If deployment fails, make sure you're logged in:"
echo "  npx supabase login"
