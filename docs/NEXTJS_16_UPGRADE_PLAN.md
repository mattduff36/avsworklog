# Next.js 16 Upgrade Plan

---

## ⚠️ **DO NOT IMPLEMENT THIS PLAN UNTIL Next.js 16.0 STABLE IS RELEASED**

**This plan is for future use only. Do not begin the upgrade until:**
- ✅ Next.js 16.0 **stable** (not RC, not canary) is officially released
- ✅ Official migration guide is published by Vercel
- ✅ Community reports indicate stable adoption

**Check release status**: https://github.com/vercel/next.js/releases

---

**Target Version**: Next.js 16.x (stable)  
**Current Version**: Next.js 15.5.11  
**Priority**: High (resolves 1 moderate security vulnerability)  
**Estimated Effort**: 8-12 hours  
**Risk Level**: Medium (breaking changes expected)

---

## Executive Summary

This document outlines the plan for upgrading from Next.js 15.5.11 to Next.js 16.x. The upgrade is necessary to resolve a moderate security vulnerability (GHSA-5f7q-jpqc-wp7h: Unbounded Memory Consumption via PPR Resume Endpoint) and to stay current with the Next.js ecosystem.

### Key Considerations
- **Wait for stable release**: Do not upgrade until Next.js 16.0 stable is released
- **Breaking changes expected**: Next.js major version upgrades typically include breaking changes
- **Comprehensive testing required**: All core features must be tested post-upgrade
- **Rollback plan mandatory**: Be prepared to revert if issues arise

---

## Current State Analysis

### Current Configuration
- **Next.js Version**: 15.5.11
- **React Version**: 19.1.2
- **App Router**: ✅ Using App Router (app directory)
- **Key Features in Use**:
  - Server Components & Server Actions
  - API Routes (app/api/*)
  - Middleware (authentication & routing)
  - Progressive Web App (PWA) with next-pwa
  - Bundle Analyzer (@next/bundle-analyzer)
  - Image Optimization
  - Custom Webpack Configuration
  - TypeScript with strict mode

### Dependencies Potentially Affected
```json
{
  "next": "^15.5.11",
  "next-pwa": "^5.6.0",
  "@next/bundle-analyzer": "^15.5.11",
  "react": "^19.1.2",
  "react-dom": "^19.1.2"
}
```

### Custom Configuration (next.config.ts)
- ✅ PWA configuration with custom service worker
- ✅ Bundle analyzer integration
- ✅ Webpack customizations (canvas aliasing, cache optimization)
- ✅ Image domain configuration
- ✅ ESLint/TypeScript build ignores
- ⚠️ **Potential Risk**: Custom webpack config may need adjustments

---

## Breaking Changes Research

### Pre-Upgrade Checklist
Before starting the upgrade, research and document:

1. **Official Migration Guide**
   - [ ] Review Next.js 16 official migration guide
   - [ ] Check codemods availability (`npx @next/codemod`)
   - [ ] Note all breaking changes
   - [ ] Identify deprecated APIs in use

2. **React Compatibility**
   - [ ] Verify React 19.x compatibility with Next.js 16
   - [ ] Check for React-specific breaking changes

3. **Third-Party Dependencies**
   - [ ] `next-pwa` compatibility with Next.js 16
   - [ ] `@next/bundle-analyzer` version alignment
   - [ ] `@supabase/ssr` compatibility
   - [ ] `nuqs` (URL state management) compatibility

4. **Known Breaking Areas** (typical in major Next.js upgrades)
   - [ ] App Router API changes
   - [ ] Server Actions changes
   - [ ] Middleware API changes
   - [ ] Image optimization changes
   - [ ] Edge Runtime changes
   - [ ] Caching behavior changes
   - [ ] Config file structure changes

---

## Upgrade Strategy

### Phase 1: Preparation (2-3 hours)

#### 1.1 Create Upgrade Branch
```bash
git checkout -b upgrade/nextjs-16
git push -u origin upgrade/nextjs-16
```

#### 1.2 Document Current State
```bash
# Capture current package versions
npm list --depth=0 > docs/upgrade-artifacts/pre-upgrade-packages.txt

# Capture current build output
npm run build > docs/upgrade-artifacts/pre-upgrade-build.log 2>&1

# Run full test suite
npm test > docs/upgrade-artifacts/pre-upgrade-tests.log 2>&1
npm run audit:all > docs/upgrade-artifacts/pre-upgrade-audit.log 2>&1
```

#### 1.3 Create Backup
- [ ] Database backup (if schema migrations pending)
- [ ] Environment variables documented
- [ ] Git tag for current stable version: `git tag pre-nextjs16-upgrade`

#### 1.4 Review Dependencies
```bash
# Check for outdated packages
npm outdated

# Audit dependencies
npm audit
```

---

### Phase 2: Upgrade Execution (3-4 hours)

#### 2.1 Update Next.js
```bash
# Install Next.js 16 (wait for stable release)
npm install next@^16.0.0

# Update related packages
npm install @next/bundle-analyzer@^16.0.0

# Update React if needed (check compatibility)
# npm install react@latest react-dom@latest
```

#### 2.2 Run Official Codemods
```bash
# Apply automatic migrations (if available)
npx @next/codemod@latest upgrade/next-16
```

#### 2.3 Update Configuration Files

**next.config.ts** - Review and update:
- [ ] Check deprecated config options
- [ ] Update webpack config if needed
- [ ] Verify PWA configuration compatibility
- [ ] Test bundle analyzer integration

**middleware.ts** - Review:
- [ ] Check for Middleware API changes
- [ ] Verify authentication flow
- [ ] Test route protection logic

**package.json** - Update scripts if needed:
- [ ] Verify build scripts
- [ ] Check for deprecated CLI flags

#### 2.4 Dependency Resolution
```bash
# Clean install to resolve peer dependencies
rm -rf node_modules package-lock.json
npm install

# Verify no peer dependency conflicts
npm ls
```

---

### Phase 3: Code Adaptation (2-3 hours)

#### 3.1 Update Imports & APIs
- [ ] Search for deprecated Next.js imports
- [ ] Update Server Component patterns if changed
- [ ] Update Server Actions if API changed
- [ ] Review dynamic imports usage

#### 3.2 Fix TypeScript Errors
```bash
# Check for type errors
npx tsc --noEmit

# Update type imports if needed
# Example: Check if NextConfig type changed
```

#### 3.3 Update API Routes
Review all routes in `app/api/*`:
- [ ] Verify NextRequest/NextResponse APIs
- [ ] Check edge runtime compatibility
- [ ] Test route handlers functionality

#### 3.4 Update Middleware
- [ ] Test authentication middleware
- [ ] Verify route matching patterns
- [ ] Check response rewriting/redirects

---

### Phase 4: Testing (3-4 hours)

#### 4.1 Build Verification
```bash
# Clean build
rm -rf .next
npm run build

# Check for build errors
# Review build output for warnings
```

#### 4.2 Development Server Testing
```bash
npm run dev

# Manual testing checklist:
# - Authentication flow
# - Protected routes
# - API endpoints
# - PWA functionality
# - Image optimization
# - Dynamic imports
```

#### 4.3 Automated Testing
```bash
# Run unit tests
npm test

# Run integration tests (if available)
npm run test:run

# Run audit suite
npm run audit:all
```

#### 4.4 Manual QA Checklist

**Core Features**:
- [ ] User authentication (login/logout)
- [ ] Dashboard loading and navigation
- [ ] Timesheet creation and submission
- [ ] Inspection creation and PDF generation
- [ ] Fleet management pages
- [ ] Workshop tasks management
- [ ] Absence management
- [ ] Reports generation (Excel exports)
- [ ] Messages and notifications
- [ ] RAMS document handling

**PWA Features**:
- [ ] Service worker registration
- [ ] Offline page functionality
- [ ] Install prompt
- [ ] Background sync (if applicable)

**Performance**:
- [ ] Lighthouse audit (score should not regress)
- [ ] Bundle size analysis (no significant increase)
- [ ] Page load times
- [ ] API response times

**Browser Testing**:
- [ ] Chrome (desktop & mobile)
- [ ] Firefox (desktop)
- [ ] Safari (desktop & mobile)
- [ ] Edge (desktop)

---

### Phase 5: Deployment Preparation (1 hour)

#### 5.1 Production Build Test
```bash
# Build for production
npm run build

# Start production server locally
npm start

# Test critical paths in production mode
```

#### 5.2 Documentation Updates
- [ ] Update README if needed
- [ ] Document any configuration changes
- [ ] Update deployment notes
- [ ] Create upgrade summary document

#### 5.3 Rollback Plan Verification
- [ ] Verify pre-upgrade git tag exists
- [ ] Document rollback steps
- [ ] Ensure database backup is accessible
- [ ] Test rollback procedure on dev branch

---

## Rollback Plan

If critical issues are discovered, use this procedure to rollback:

### Immediate Rollback (Code Only)
```bash
# Switch back to previous version
git checkout main
git reset --hard pre-nextjs16-upgrade

# Or revert the merge commit
git revert <merge-commit-sha> -m 1

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### Full Rollback (Including Database)
```bash
# Restore code (as above)
# ... code rollback steps ...

# Restore database if schema changed
# (Run database restore procedure if applicable)

# Redeploy previous version
git push --force origin main
# (Trigger CI/CD or manual deploy)
```

---

## Deployment Strategy

### Staging Deployment
1. Deploy to staging environment first
2. Run full QA cycle on staging
3. Monitor for 24-48 hours
4. Check error logs and performance metrics

### Production Deployment
1. **Deploy during low-traffic period** (e.g., weekend, late evening)
2. **Incremental rollout** (if infrastructure supports):
   - Deploy to 10% of traffic
   - Monitor for 1 hour
   - Deploy to 50% of traffic
   - Monitor for 2 hours
   - Deploy to 100% of traffic
3. **Monitor critical metrics**:
   - Error rates
   - Response times
   - User sessions
   - API success rates

### Post-Deployment Monitoring
- **First 1 hour**: Active monitoring, team on standby
- **First 24 hours**: Frequent checks, quick response to issues
- **First 1 week**: Daily monitoring, performance comparison
- **After 1 week**: Normal monitoring, upgrade considered stable

---

## Risk Mitigation

### High-Risk Areas

1. **Custom Webpack Configuration**
   - **Risk**: Webpack API changes may break custom config
   - **Mitigation**: Test bundle analyzer and PWA build extensively
   - **Fallback**: Simplify webpack config if issues arise

2. **PWA Functionality (next-pwa)**
   - **Risk**: next-pwa may not be compatible with Next.js 16
   - **Mitigation**: Check next-pwa GitHub issues, consider alternatives
   - **Fallback**: Temporarily disable PWA if blocking

3. **Server Actions & Server Components**
   - **Risk**: API changes may require code updates
   - **Mitigation**: Review all server actions and components
   - **Fallback**: Revert to client-side logic if needed

4. **Middleware Authentication**
   - **Risk**: Breaking changes in middleware API
   - **Mitigation**: Extensive testing of auth flow
   - **Fallback**: Critical - must work or rollback

### Medium-Risk Areas

1. **API Routes**
   - Test all endpoints thoroughly
   - Verify Excel export functionality
   - Check PDF generation routes

2. **Image Optimization**
   - Verify Supabase storage integration
   - Test image loading performance

3. **Third-Party Integrations**
   - Supabase SSR
   - React Query
   - Form libraries

---

## Success Criteria

The upgrade is considered successful when:

- [x] All builds complete without errors
- [x] All automated tests pass
- [x] Manual QA checklist 100% complete
- [x] No new console errors in browser
- [x] No new server errors in logs
- [x] Lighthouse performance score unchanged or improved
- [x] Bundle size not significantly increased (< 5%)
- [x] PWA functionality works as before
- [x] All core user flows tested and working
- [x] Production deployment completed successfully
- [x] No critical issues reported in first 48 hours

---

## Communication Plan

### Before Upgrade
- **Team notification**: "Planning Next.js 16 upgrade - scheduled for [DATE]"
- **Stakeholders**: Inform of potential brief downtime during deployment
- **Users**: Prepare maintenance window notice (if needed)

### During Upgrade
- **Team updates**: Regular status updates in team chat
- **Issue tracking**: Document any unexpected issues
- **Progress tracking**: Update checklist in real-time

### After Upgrade
- **Team summary**: Share upgrade results and lessons learned
- **Stakeholders**: Confirm successful completion
- **Documentation**: Update internal docs with any configuration changes

---

## Timeline Estimate

### Optimistic (8 hours)
- Preparation: 2 hours
- Upgrade: 2 hours
- Code adaptation: 1 hour
- Testing: 2 hours
- Deployment: 1 hour

### Realistic (12 hours)
- Preparation: 3 hours
- Upgrade: 3 hours
- Code adaptation: 2 hours
- Testing: 3 hours
- Deployment: 1 hour

### Pessimistic (20+ hours - if major issues)
- Additional debugging: 4-8 hours
- Dependency resolution: 2-4 hours
- Extensive code changes: 2-4 hours
- Extended testing: 2-4 hours

**Recommendation**: Allocate 2 full days for the upgrade work, with team availability for support.

---

## Prerequisites

Before starting the upgrade:

- [ ] Next.js 16.0 stable release is available
- [ ] Official migration guide is published
- [ ] All current PRs are merged or paused
- [ ] Current main branch is stable and tested
- [ ] Team availability confirmed for upgrade period
- [ ] Rollback plan reviewed and approved
- [ ] Stakeholder approval obtained
- [ ] Maintenance window scheduled (if needed)

---

## References & Resources

### Official Documentation
- Next.js 16 Release Notes: https://nextjs.org/blog/next-16 (when available)
- Next.js 16 Migration Guide: https://nextjs.org/docs/upgrading (when available)
- Next.js Codemods: https://nextjs.org/docs/app/building-your-application/upgrading/codemods

### Community Resources
- Next.js GitHub Discussions: https://github.com/vercel/next.js/discussions
- Next.js Discord: https://nextjs.org/discord
- Reddit r/nextjs: https://reddit.com/r/nextjs

### Key Dependencies
- next-pwa GitHub: https://github.com/shadowwalker/next-pwa
- Supabase Next.js Guide: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs

---

## Post-Upgrade Actions

After successful upgrade:

1. **Security Audit**
   ```bash
   npm audit
   # Should show 0 moderate vulnerabilities
   ```

2. **Performance Baseline**
   - Run Lighthouse audits
   - Document bundle sizes
   - Record build times

3. **Documentation**
   - Update AUDIT_REMAINING_ISSUES.md
   - Create upgrade completion report
   - Document any configuration changes

4. **Cleanup**
   - Remove upgrade branch after merge
   - Archive upgrade artifacts
   - Clean up temporary files

5. **Monitoring Setup**
   - Set up alerts for error spikes
   - Monitor performance metrics
   - Track user feedback

---

## Notes & Warnings

⚠️ **IMPORTANT**: Do NOT upgrade until:
1. Next.js 16.0 stable is released (not RC or canary)
2. Migration guide is available
3. Community adoption shows stable patterns
4. Critical dependencies confirm compatibility

⚠️ **PWA Consideration**: next-pwa v5.6.0 is relatively old and may have compatibility issues with Next.js 16. Be prepared to:
- Upgrade to a newer PWA solution if available
- Migrate to Vercel's native PWA support (if released)
- Temporarily disable PWA functionality if blocking

⚠️ **React 19**: Currently on React 19.1.2. Verify Next.js 16's recommended React version and upgrade React if needed.

⚠️ **Testing is Critical**: This is a production application. DO NOT skip testing steps. Every core feature must be verified.

---

**Plan Version**: 1.0  
**Created**: 2026-02-04  
**Last Updated**: 2026-02-04  
**Status**: Draft - Awaiting Next.js 16 stable release

---

**End of Plan**
