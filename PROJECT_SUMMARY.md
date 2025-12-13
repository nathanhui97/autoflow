# GhostWriter (Autoflow) - Project Summary

## 📋 Product Description

**GhostWriter** (also known as Autoflow) is an AI-powered Chrome Extension that transforms repetitive browser tasks into reusable "Micro-Apps" with intelligent automation. Unlike traditional macro recorders that play back static scripts, GhostWriter uses AI to understand user intent, automatically parameterize workflows, and create intuitive form interfaces for future executions.

### Core Value Proposition

**"Turn repetitive browser tasks into reusable Micro-Apps instantly."**

The extension watches you perform a task once, understands the context semantically (not just CSS selectors), and creates a user-friendly form interface for future executions. This makes browser automation accessible to non-technical users while maintaining reliability even when websites update their UI.

### Key Differentiators

1. **Semantic Understanding**: Captures human context (labels, placeholders, surrounding text) rather than brittle CSS selectors
2. **Auto-Parameterization**: AI automatically detects variables from user actions and builds appropriate form inputs
3. **Self-Healing**: Execution engine adapts to UI changes using semantic matching and AI-powered element recovery
4. **No-Code Interface**: Users interact with simple forms, not scripts
5. **Visual Intelligence**: Uses computer vision and AI to understand page layouts and element relationships

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: React 19.2.0 with TypeScript
- **Build Tool**: Vite 7.2.4
- **Chrome Extension**: Manifest V3
- **State Management**: Zustand 5.0.9
- **Styling**: Tailwind CSS 3.4.0
- **Extension Plugin**: @crxjs/vite-plugin 2.2.1

### Backend & AI
- **AI Provider**: Google Gemini 2.5 Flash API
- **Backend Platform**: Supabase (Edge Functions)
- **Database**: Supabase PostgreSQL (for AI caching)
- **API Architecture**: Serverless Edge Functions (Deno runtime)

### Development Tools
- **TypeScript**: 5.9.3
- **ESLint**: 9.39.1 with React plugins
- **PostCSS**: 8.5.6 with Autoprefixer
- **Node.js**: Latest LTS

### Browser APIs
- Chrome Extension APIs:
  - `chrome.tabs` - Tab management
  - `chrome.storage` - Local data persistence
  - `chrome.scripting` - Content script injection
  - `chrome.sidePanel` - Side panel UI
  - `chrome.runtime` - Message passing

---

## 🏗️ Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │  Side Panel  │◄────►│ Content      │◄────►│ Background│ │
│  │  (React UI)  │      │ Script       │      │ Service   │ │
│  └──────────────┘      └──────────────┘      └───────────┘ │
│         │                      │                             │
│         │                      │                             │
│         └──────────────────────┼─────────────────────────────┘
│                                │                             │
│                                ▼                             │
│                    ┌───────────────────────┐                 │
│                    │   Supabase Edge       │                 │
│                    │   Functions           │                 │
│                    └───────────────────────┘                 │
│                                │                             │
│                                ▼                             │
│                    ┌───────────────────────┐                 │
│                    │   Gemini 2.5 Flash    │                 │
│                    │   API                 │                 │
│                    └───────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### Component Architecture

#### 1. **Content Script Layer** (`src/content/`)
The core automation engine that runs on web pages:

- **`content-script.ts`**: Main entry point, message handling
- **`recording-manager.ts`**: Captures user interactions (clicks, inputs, navigation)
- **`execution-engine.ts`**: Executes recorded workflows with multi-level fallback
- **`element-finder.ts`**: 9-strategy element finding system (8 rule-based + 1 AI-powered)
- **`selector-engine.ts`**: Generates stable CSS selectors
- **`visual-snapshot.ts`**: Captures viewport and element screenshots
- **`element-context.ts`**: Extracts semantic context (labels, surrounding text)
- **`wait-conditions.ts`**: Determines what to wait for between steps
- **`ai-data-builder.ts`**: Prepares data for AI analysis
- **`ai-workflow-analyzer.ts`**: Analyzes workflow patterns and intent

#### 2. **Library Layer** (`src/lib/`)
Shared utilities and services:

- **`ai-service.ts`**: Client-side AI service (calls Supabase Edge Functions)
- **`ai-cache.ts`**: Two-tier caching (local + server)
- **`ai-config.ts`**: Supabase configuration
- **`dom-distiller.ts`**: Extracts relevant DOM snippets for AI
- **`pii-scrubber.ts`**: Removes PII before AI calls
- **`variable-detector.ts`**: Detects variables in workflows
- **`visual-analysis.ts`**: Visual understanding services
- **`visual-wait.ts`**: Visual-based wait conditions
- **`visual-flow.ts`**: Tracks visual state changes
- **`correction-memory.ts`**: Learns from user corrections
- **`storage.ts`**: Workflow persistence
- **`store.ts`**: Zustand state management
- **`bridge.ts`**: Message passing between components

#### 3. **Side Panel UI** (`src/sidepanel/`)
React-based user interface:

- **`App.tsx`**: Main UI component (workflow library, recording controls)
- **`ReplayerView.tsx`**: Workflow execution view
- **`VariableInputForm.tsx`**: Dynamic form for variable inputs

#### 4. **Background Service** (`src/background/`)
- **`service-worker.ts`**: Background script for extension lifecycle

#### 5. **Supabase Edge Functions** (`supabase/functions/`)
Serverless functions for AI processing:

- **`recover_element/`**: AI-powered element recovery (Phase 3)
- **`validate_selector/`**: Proactive selector validation (Phase 2)
- **`detect_variables/`**: Variable detection from workflows
- **`analyze_intent/`**: Workflow intent analysis
- **`generate_step_description/`**: Natural language step descriptions
- **`visual_analysis/`**: Visual understanding of pages
- **`visual_similarity/`**: Visual similarity matching
- **`classify_page_type/`**: Page type classification
- **`smart_input_handler/`**: Intelligent input handling

---

## 🎯 Key Features & Capabilities

### 1. **Semantic Recording**
- Captures element context (labels, placeholders, surrounding text)
- Records visual snapshots for AI understanding
- Tracks element state, viewport, and timing
- Detects iframe contexts and shadow DOM boundaries
- Captures wait conditions automatically

### 2. **AI-Powered Element Finding** (9 Strategies)
1. Primary selector (best stable selector)
2. Fallback selectors (backup options)
3. XPath text matching
4. Label-based finding
5. Context-based matching
6. Similarity matching
7. Visual snapshot matching
8. Coordinate-based fallback
9. **AI Element Recovery** (when all else fails)

### 3. **Proactive Selector Validation** (Phase 2)
- Detects fragile selectors during recording
- AI suggests better alternatives in background
- Automatically improves selectors before saving
- Non-blocking (doesn't slow down recording)

### 4. **Reactive Element Recovery** (Phase 3)
- When selectors fail, AI analyzes page visually
- Uses multimodal AI (text + images) to find elements
- Two-tier caching for performance
- PII scrubbing for privacy

### 5. **Variable Detection & Parameterization**
- Automatically detects variables from user actions
- Creates dynamic forms for workflow execution
- Supports text, number, email, date inputs
- Variable substitution during execution

### 6. **Visual Intelligence** (Phase 4)
- Page type classification (form, dashboard, table, etc.)
- Visual importance scoring
- Visual flow tracking (before/after states)
- Human-like understanding of page layouts

### 7. **Multi-Level Execution Fallback**
- **Level 1**: Standard element finding (9 strategies)
- **Level 2**: Vision-based coordinate clicking
- **Level 3**: Chrome DevTools Protocol fallback

### 8. **Wait Condition Intelligence**
- Automatic wait condition detection
- Element visibility waits
- Text appearance waits
- URL pattern waits
- Visual state waits

### 9. **Correction Learning**
- Users can correct failed steps
- System learns from corrections
- Improves future executions

### 10. **Security & Privacy**
- All API keys stored server-side (Supabase secrets)
- PII scrubbing before AI calls
- No sensitive data in client code
- Secure deployment practices

---

## 📊 Implementation Progress

### ✅ Completed Phases

#### **Phase 1: Core Recording & Execution**
- ✅ Event capture (clicks, inputs, navigation, keyboard, scroll)
- ✅ Selector generation with fallbacks
- ✅ Basic execution engine
- ✅ Workflow storage and management
- ✅ Side panel UI

#### **Phase 2: AI Selector Validator** (Proactive)
- ✅ Fragile selector detection
- ✅ Background AI validation
- ✅ Automatic selector improvement
- ✅ Non-blocking validation
- ⚠️ Edge Function needs deployment

#### **Phase 3: AI Element Finder** (Reactive)
- ✅ AI-powered element recovery
- ✅ Multimodal AI requests (text + images)
- ✅ Two-tier caching system
- ✅ PII scrubbing
- ✅ Geometric filtering
- ✅ **Fully deployed and active**

#### **Phase 4: Visual Intelligence**
- ✅ Visual snapshot capture
- ✅ Page type classification
- ✅ Visual importance scoring
- ✅ Visual flow tracking
- ✅ Human-like page understanding

#### **Phase 5: Variable Detection**
- ✅ Automatic variable detection
- ✅ Dynamic form generation
- ✅ Variable substitution during execution
- ✅ Variable input UI

### 🔄 Current Status

**Production Ready Features:**
- Core recording and execution
- AI element recovery (Phase 3)
- Variable detection and parameterization
- Visual intelligence
- Multi-level execution fallback

**Needs Deployment:**
- Phase 2: Selector validator Edge Function (code complete, needs deployment)

**Known Issues:**
- See `EXECUTION_ENGINE_INVESTIGATION.md` for detailed investigation of edge cases
- Some coordinate handling improvements needed
- Wait condition edge cases

### 📈 Metrics & Performance

**Cost Optimization:**
- AI recovery: ~$0.0005 per request (Gemini Flash)
- Selector validation: ~$0.001 per validation
- Estimated monthly cost: ~$1-2 for 1000 workflows
- Two-tier caching reduces API calls by ~80%

**Reliability:**
- AI recovery success rate target: >70% when selectors fail
- Usage target: <5% of workflows need AI recovery
- Most workflows succeed with rule-based strategies

**Performance:**
- Recording: Real-time, no noticeable lag
- Execution: <5 seconds for AI recovery when needed
- Local cache: <100ms lookup time
- Non-blocking validation: No impact on recording speed

---

## 🔐 Security Architecture

### API Key Management
- ✅ **No API keys in client code**
- ✅ **All Gemini API calls through Supabase Edge Functions**
- ✅ **API keys stored in Supabase secrets**
- ✅ **Never exposed to GitHub**
- ✅ **PII scrubbing before AI calls**

### Data Flow Security
```
User Action → Content Script → Supabase Edge Function → Gemini API
                (no API keys)      (has API keys)        (secure)
```

### Privacy Protection
- PII scrubbing (emails, phones, credit cards, SSN)
- Data minimization (only relevant context sent)
- Local caching (reduces external calls)
- Secure deployment scripts

---

## 📁 Project Structure

```
autoflow-chrome-extension/
├── src/
│   ├── background/          # Service worker
│   ├── content/             # Content script layer (core automation)
│   ├── lib/                 # Shared utilities and services
│   ├── sidepanel/           # React UI components
│   └── types/               # TypeScript type definitions
├── supabase/
│   ├── functions/           # Edge Functions (AI processing)
│   └── migrations/          # Database migrations
├── dist/                    # Build output
├── public/                  # Static assets
└── Documentation files      # Various .md files
```

### Key Files

**Core Automation:**
- `src/content/recording-manager.ts` (2,342 lines) - Recording engine
- `src/content/execution-engine.ts` (971 lines) - Execution engine
- `src/content/element-finder.ts` - Element finding strategies

**AI Services:**
- `src/lib/ai-service.ts` - AI service client
- `supabase/functions/recover_element/index.ts` - AI recovery
- `supabase/functions/validate_selector/index.ts` - Selector validation

**UI:**
- `src/sidepanel/App.tsx` (1,450 lines) - Main UI
- `src/sidepanel/ReplayerView.tsx` - Execution view
- `src/sidepanel/VariableInputForm.tsx` - Variable form

---

## 🚀 Deployment

### Chrome Extension
```bash
npm run build
# Load dist/ folder in Chrome Extensions (Developer Mode)
```

### Supabase Edge Functions
```bash
npx supabase functions deploy <function-name>
npx supabase secrets set GEMINI_API_KEY=<key>
```

### Current Deployment Status
- ✅ Database: `ai_cache` table deployed
- ✅ Edge Functions: 8 functions created
  - ✅ `recover_element` - Deployed and active
  - ⚠️ `validate_selector` - Needs deployment
  - ✅ Others: Various states

---

## 🧪 Testing & Quality

### Testing Approach
- Manual testing with real websites
- Console logging for debugging
- Visual snapshot verification
- AI recovery testing with UI changes

### Code Quality
- TypeScript for type safety
- ESLint for code quality
- Modular architecture
- Comprehensive error handling

---

## 📚 Documentation

The project includes extensive documentation:

- `README.md` - Project overview
- `PHASE_2_IMPLEMENTATION_SUMMARY.md` - Selector validation
- `PHASE_3_IMPLEMENTATION_SUMMARY.md` - Element recovery
- `SECURITY_GUIDE.md` - Security best practices
- `EXECUTION_ENGINE_INVESTIGATION.md` - Known issues
- `SUPABASE_DEPLOYMENT.md` - Deployment guide
- Various testing and setup guides

---

## 🎯 Future Enhancements

### Potential Improvements
1. **Adaptive Execution**: Use workflow intent for smarter execution
2. **Multi-Tab Orchestration**: Better tab switching and coordination
3. **Error Recovery**: More robust error handling and recovery
4. **Performance**: Further optimization of AI calls
5. **UI/UX**: Enhanced user interface and workflow visualization
6. **Testing**: Automated testing suite
7. **Analytics**: Usage tracking and insights

---

## 📝 Summary

**GhostWriter** is a sophisticated AI-powered browser automation tool that combines:
- **Semantic understanding** of web pages
- **AI-powered reliability** (proactive and reactive)
- **User-friendly interface** (no-code forms)
- **Enterprise-grade security** (server-side API keys, PII protection)
- **Cost-effective AI** (caching, selective usage)

The project is in active development with core features production-ready. The architecture is scalable, secure, and designed for reliability even when websites change their UI.

**Status**: Production-ready core features, with ongoing improvements and optimizations.

---

*Last Updated: December 2025*

