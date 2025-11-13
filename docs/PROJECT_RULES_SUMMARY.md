# Project Rules Summary

This document summarizes all the rules and conventions set for the Squires App project.

---

## 🎯 Core Project Rules (`.cursor/rules/squiresapp.mdc`)

### 1. Build Control
- Run test builds **only** when user says "run tests" or "start test build"
- Before running tests, confirm branch and scope in one line

### 2. Git Pushes
- Push to GitHub **only** when user explicitly says to push
- Local commits are allowed
- Always state what will be pushed before pushing

### 3. Database and Migrations ⭐ **IMPORTANT**
- Assume `.env.local` exists with required variables
- **Generate and run migrations yourself** - don't ask user to run commands
- Do not ask user to run commands unless blocked by missing variables or permissions
- **Never print or expose secrets** from `.env.local`

### 4. PRD Alignment
- Track every task to a PRD section or ID
- If a change risks drifting from the PRD, pause and ask for approval

### 5. Code Quality
- Follow best practices
- Keep functions small and typed
- Add or update unit tests when changing behavior
- Keep lint and type checks green

### 6. Documentation
- Do not create user guides unless user asks
- Update developer docs only when behavior changes

### 7. Token Usage
- Be concise
- Prefer diffs or minimal patches over full files
- Avoid boilerplate unless needed to run

### 8. Branching and Commits
- Work on feature branches: `feature/<short-topic>`
- Make small, focused PRs
- Use clear commit messages: `type(scope): summary`

### 9. Output Format
- When changing files, output unified diff or file-by-file patch
- When adding commands, show exact shell lines

### 10. Long or Risky Actions
- For operations affecting CI, deployments, data, or large refactors, ask for one-line confirmation before proceeding

### 11. Errors and Blocking Issues
- If blocked, report error in one short paragraph
- Propose a fix or decision path
- Do not request credentials
- Ask for minimum extra info needed

### 12. Privacy and Security
- Never echo environment values
- Redact tokens and secrets in logs and examples

---

## 💻 Code Style Rules (`.cursorrules`)

### General Approach
- Expert in TypeScript, Node.js, Next.js App Router, React, Shadcn UI, Radix UI, Tailwind
- Provide accurate, factual, thoughtful answers
- Explain logic and reasoning if there's a better way
- **Start each task by writing "Rule active"** to confirm understanding
- **Never automatically push to GitHub** - always ask for approval
- Use `mpdee-server` (SSH: `matt@mpdee-server`) for heavy processing like `npm build` when possible

### Code Style and Structure
- Write concise, technical TypeScript code
- Use functional and declarative programming patterns
- **Avoid classes** - use functions instead
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- Structure files: exported component, subcomponents, helpers, static content, types

### Naming Conventions
- Use **lowercase with dashes** for directories (e.g., `components/auth-wizard`)
- Favor **named exports** for components

### TypeScript Usage
- Use TypeScript for all code
- **Prefer interfaces over types**
- **Avoid enums** - use maps instead
- Use functional components with TypeScript interfaces

### Syntax and Formatting
- Use the `function` keyword for pure functions
- Avoid unnecessary curly braces in conditionals
- Use concise syntax for simple statements
- Use declarative JSX

### UI and Styling
- Use **Shadcn UI, Radix, and Tailwind** for components and styling
- Implement responsive design with Tailwind CSS
- **Mobile-first approach**

### Performance Optimization
- **Minimize `use client`, `useEffect`, and `setState`**
- **Favor React Server Components (RSC)**
- Wrap client components in Suspense with fallback
- Use dynamic loading for non-critical components
- Optimize images: WebP format, include size data, lazy loading

### Key Conventions
- Use `nuqs` for URL search parameter state management
- Optimize Web Vitals (LCP, CLS, FID)
- **Limit `use client`**:
  - Favor server components and Next.js SSR
  - Use only for Web API access in small components
  - **Avoid for data fetching or state management**

### Next.js Best Practices
- Follow Next.js docs for Data Fetching, Rendering, and Routing

---

## 📋 Key Takeaways

### Most Important Rules:
1. **Database Migrations**: Run them yourself automatically - don't ask user
2. **Git Pushes**: Never push automatically - always ask first
3. **Security**: Never expose secrets or environment variables
4. **Code Style**: Functional components, TypeScript, mobile-first, server components preferred
5. **PRD Alignment**: Track all tasks to PRD sections

### When Starting a Task:
1. Write "Rule active" to confirm understanding
2. Check if migration needed - run it automatically
3. Work on feature branch if making changes
4. Keep code concise and follow TypeScript best practices
5. Ask for confirmation before risky operations

### Common Patterns:
- Feature branches: `feature/<short-topic>`
- Commit messages: `type(scope): summary`
- Directory names: lowercase-with-dashes
- Components: named exports, functional style
- Prefer server components over client components

---

**Last Updated**: December 2025  
**Rules Location**: `.cursor/rules/squiresapp.mdc` and `public/.cursorrules`

