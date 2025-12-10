#!/bin/bash
# Quick deployment script for Supabase Edge Function
# Run this in your terminal (not via automation)

set -e

PROJECT_REF="jfboagngbpzollcipewh"
GEMINI_API_KEY="AIzaSyBfLwmgunY7n9ckJYQKVYQ0_uhvc5SQoIM"

echo "🚀 Deploying recover_element Edge Function to Supabase..."
echo ""
echo "Project: autoflow (${PROJECT_REF})"
echo ""

# Step 1: Login
echo "Step 1: Logging in to Supabase..."
echo "This will open a browser window for authentication."
npx supabase login

# Step 2: Link project
echo ""
echo "Step 2: Linking to project..."
npx supabase link --project-ref ${PROJECT_REF}

# Step 3: Deploy function
echo ""
echo "Step 3: Deploying recover_element function..."
npx supabase functions deploy recover_element

# Step 4: Set secret
echo ""
echo "Step 4: Setting GEMINI_API_KEY secret..."
npx supabase secrets set GEMINI_API_KEY=${GEMINI_API_KEY}

echo ""
echo "✅ Deployment complete!"
echo ""
echo "The Edge Function is now available at:"
echo "https://jfboagngbpzollcipewh.supabase.co/functions/v1/recover_element"
echo ""
echo "You can test it by running a workflow that triggers AI recovery."
