#!/bin/bash
# Fix all remaining light theme issues across the codebase
# This replaces problematic patterns with dark-only equivalents

echo "🔍 Fixing remaining light theme issues..."
echo ""

# Pattern 1: hover:bg-slate-50 dark:hover:bg-slate-XXX
echo "1. Fixing hover:bg-slate-50 patterns..."
find app components -name "*.tsx" -type f -exec sed -i 's/hover:bg-slate-50 dark:hover:bg-slate-800\/50/hover:bg-slate-800\/50/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/hover:bg-slate-50 dark:hover:bg-slate-800/hover:bg-slate-800\/50/g' {} +

# Pattern 2: hover:bg-slate-100 dark:hover:bg-slate-XXX  
echo "2. Fixing hover:bg-slate-100 patterns..."
find app components -name "*.tsx" -type f -exec sed -i 's/hover:bg-slate-100 dark:hover:bg-slate-800\/50/hover:bg-slate-800\/50/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/hover:bg-slate-100 dark:hover:bg-slate-800/hover:bg-slate-800/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/hover:bg-slate-100 dark:hover:bg-slate-700/hover:bg-slate-700\/50/g' {} +

# Pattern 3: bg-white dark:bg-slate-XXX
echo "3. Fixing bg-white patterns..."
find app components -name "*.tsx" -type f -exec sed -i 's/bg-white dark:bg-slate-900/bg-slate-900/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/bg-white dark:bg-slate-800/bg-slate-800/g' {} +

# Pattern 4: border-slate-200 dark:border-slate-700
echo "4. Fixing border-slate-200 patterns..."
find app components -name "*.tsx" -type f -exec sed -i 's/border-slate-200 dark:border-slate-700/border-slate-700/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/border-slate-300 dark:border-slate-600/border-slate-600/g' {} +

# Pattern 5: text-slate-XXX dark:text-slate-XXX
echo "5. Fixing text color patterns..."
find app components -name "*.tsx" -type f -exec sed -i 's/text-slate-900 dark:text-white/text-white/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/text-slate-800 dark:text-white/text-white/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/text-slate-700 dark:text-slate-300/text-slate-300/g' {} +
find app components -name "*.tsx" -type f -exec sed -i 's/text-slate-600 dark:text-slate-400/text-slate-400/g' {} +

echo ""
echo "✅ All patterns replaced!"
echo ""
echo "Files modified:"
git diff --name-only
