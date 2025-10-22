# Squires - Comprehensive Development Plan

**Created**: October 22, 2025  
**Goal**: Build a production-ready, extensible PWA for A&V Squires Plant Co. Ltd.

---

## 📋 Current State Analysis

### ✅ What's Complete (100%)
- Next.js 15 + TypeScript infrastructure
- Supabase database with full schema
- Authentication system (login, roles, sessions)
- Mobile-first UI with "Squires" branding
- Timesheet module (create, edit, view, submit, approve, PDF)
- Vehicle Inspection module (create, edit, view, submit, approve, PDF, photos)
- Digital signatures with enforcement
- Manager approval workflow with comments
- PWA icons and manifest
- Dashboard with square button grid
- Role-based access control

### ⚠️ What Needs Attention
1. **End-to-end workflow testing** - Verify employee → manager flow works perfectly
2. **Placeholder pages** - Reports and Admin sections need structure
3. **Code quality** - Ensure extensibility for future forms
4. **Bug fixes** - Any issues discovered during testing

---

## 🎯 Development Stages

### **Stage 1: App Structure & Scaffolding** (Today - Phase 1)
**Goal**: Client can see complete app structure and navigation

#### 1.1 Create Placeholder Pages
- [ ] Reports page (`/reports`)
  - Date range selector UI
  - Report type selector (Timesheet, Inspection, Payroll, etc.)
  - Download buttons (PDF/Excel) - functionality TBD
  - Charts/statistics placeholders
  - "Coming soon" indicators for pending features

- [ ] Admin/Users page (`/admin/users`)
  - User list table structure
  - Add/edit user form placeholders
  - Role management UI
  - Bulk actions placeholders
  - Proper admin-only access control

- [ ] Approvals page improvements
  - Already exists, verify it's complete
  - Ensure tabbed interface works (Timesheets/Inspections)
  - Quick actions (approve/reject) functional

#### 1.2 Navigation & Access Control
- [ ] Verify all navigation links work
- [ ] Test role-based menu items (employee vs manager vs admin)
- [ ] Ensure unauthorized access is blocked
- [ ] Add breadcrumbs where needed

#### 1.3 Empty States & Loading States
- [ ] Add proper empty states to all list pages
- [ ] Add loading skeletons to improve perceived performance
- [ ] Add error states with retry actions

---

### **Stage 2: Perfect Timesheet Workflow** (Today - Phase 2)
**Goal**: Complete, bug-free timesheet lifecycle

#### 2.1 Employee Flow Testing
- [ ] **Create timesheet**
  - Test tabbed Mon-Sun interface
  - Verify time calculations
  - Test yard work checkbox
  - Test remarks field
  - Verify validation errors display properly
  - Test save as draft

- [ ] **Add signature**
  - Verify signature pad works on desktop
  - Verify signature pad works on mobile/touch
  - Test clear signature
  - Verify submission is blocked without signature

- [ ] **Submit timesheet**
  - Verify status changes to "submitted"
  - Verify submitted_at timestamp
  - Verify can't edit after submission
  - Test toast/feedback message

#### 2.2 Manager Flow Testing
- [ ] **View pending timesheets**
  - Navigate to /approvals
  - Verify Timesheets tab shows pending items
  - Verify employee details display correctly
  - Test "View Details" button

- [ ] **Review timesheet**
  - View all entries for the week
  - Verify signature displays
  - Verify total hours calculation
  - Test approve action
  - Test reject action with required comments

- [ ] **Approved workflow**
  - Verify status changes to "approved"
  - Verify reviewed_at timestamp
  - Verify reviewed_by is set
  - Test PDF download includes approval info

- [ ] **Rejected workflow**
  - Verify status changes to "rejected"
  - Verify manager comments are saved
  - Verify employee can see rejection reason
  - Verify employee can edit and resubmit

#### 2.3 Bug Fixes & Polish
- [ ] Fix any validation issues
- [ ] Improve error messages
- [ ] Add loading states during save/submit
- [ ] Test offline functionality (if time permits)
- [ ] Verify mobile responsiveness

---

### **Stage 3: Perfect Inspection Workflow** (Today - Phase 3)
**Goal**: Complete, bug-free inspection lifecycle

#### 3.1 Employee Flow Testing
- [ ] **Create inspection**
  - Test vehicle selector dropdown
  - Test date picker
  - Test 26-point checklist with Pass/Fail buttons
  - Verify progress tracking (X/26 completed)
  - Test comments for each item
  - Test photo upload for defects
  - Verify validation (all items must be marked)
  - Test save as draft

- [ ] **Submit inspection**
  - Verify status changes to "submitted"
  - Verify submitted_at timestamp
  - Verify can't edit after submission
  - Test feedback message

#### 3.2 Manager Flow Testing
- [ ] **View pending inspections**
  - Navigate to /approvals
  - Verify Inspections tab shows pending items
  - Verify vehicle and date display correctly
  - Test "View Details" button

- [ ] **Review inspection**
  - View all 26 items with status
  - Verify defects are highlighted
  - View uploaded photos
  - Test approve action
  - Test reject action with required comments

- [ ] **Approved workflow**
  - Verify status changes to "approved"
  - Verify reviewed_at timestamp
  - Test PDF download includes defects summary

- [ ] **Rejected workflow**
  - Verify status changes to "rejected"
  - Verify manager comments are saved
  - Verify employee can see rejection reason
  - Verify employee can edit and resubmit

#### 3.3 Bug Fixes & Polish
- [ ] Fix any validation issues
- [ ] Improve error messages
- [ ] Test photo upload/display
- [ ] Verify mobile responsiveness
- [ ] Test defect highlighting in PDF

---

### **Stage 4: Code Quality & Extensibility** (If time today)
**Goal**: Clean, maintainable codebase ready for future forms

#### 4.1 Code Review
- [ ] Review form configuration system (lib/config/forms.ts)
- [ ] Ensure new forms can be added easily
- [ ] Check for code duplication
- [ ] Verify consistent error handling
- [ ] Check TypeScript types are accurate

#### 4.2 Documentation
- [ ] Update README with current features
- [ ] Document how to add new form types
- [ ] Document database schema
- [ ] Add code comments where needed

#### 4.3 Performance
- [ ] Check bundle size
- [ ] Test page load times
- [ ] Verify image optimization
- [ ] Check for unnecessary re-renders

---

### **Stage 5: Testing & Verification** (End of today)
**Goal**: Confident the app works perfectly for the two main forms

#### 5.1 Complete User Journeys
- [ ] **Employee Journey**
  1. Log in as employee
  2. Create timesheet for current week
  3. Fill out all days
  4. Add signature
  5. Submit for approval
  6. Create vehicle inspection
  7. Mark all 26 items
  8. Upload photo for a defect
  9. Submit for approval
  10. Log out

- [ ] **Manager Journey**
  1. Log in as manager
  2. View pending timesheets
  3. Review and approve one
  4. Review and reject one with comments
  5. View pending inspections
  6. Review and approve one
  7. Download PDFs
  8. Log out

- [ ] **Round-trip Journey**
  1. Employee submits timesheet
  2. Manager rejects with comments
  3. Employee views rejection
  4. Employee edits and resubmits
  5. Manager approves
  6. Employee views approved status

#### 5.2 Cross-browser Testing
- [ ] Test on Chrome
- [ ] Test on Safari
- [ ] Test on Firefox
- [ ] Test on mobile Chrome
- [ ] Test on mobile Safari

#### 5.3 Final Verification
- [ ] All navigation works
- [ ] All role restrictions work
- [ ] All validations work
- [ ] All feedback messages are clear
- [ ] PDFs generate correctly
- [ ] Signatures display correctly
- [ ] Photos display correctly

---

## 🚀 Future Stages (Not Today)

### Stage 6: Optional Enhancements
- Debounced auto-save for drafts
- Excel export functionality
- Real-time live updates
- Email notifications
- Toast notification system (sonner)
- Advanced reporting dashboard
- User management UI completion
- Bulk approval actions

### Stage 7: Additional Forms
- Incident Report
- Maintenance Request
- Delivery Note
- Site Diary
- Risk Assessment
- Plant Hire
- Quality Check
- Daily Report

---

## ✅ Success Criteria (End of Today)

1. **Structure Complete**
   - All pages exist and are accessible
   - Navigation works correctly
   - Client can see entire app flow

2. **Timesheets Perfect**
   - Employee can create, edit, sign, and submit
   - Manager can review, approve, and reject
   - Rejected timesheets can be edited and resubmitted
   - PDFs generate correctly with signatures

3. **Inspections Perfect**
   - Employee can create, mark items, upload photos, and submit
   - Manager can review, approve, and reject
   - Rejected inspections can be edited and resubmitted
   - PDFs generate correctly with defects highlighted

4. **Code Quality**
   - Clean, readable code
   - Consistent patterns
   - Easy to extend with new forms
   - Proper error handling

5. **Documentation**
   - README updated
   - Development plan documented
   - Next steps clear

---

## 🎯 Today's Priority Order

1. ✅ Create this development plan
2. **Create placeholder pages** (Reports, Admin) - 30 min
3. **Test timesheet workflow end-to-end** - 45 min
4. **Fix any timesheet issues** - 30 min
5. **Test inspection workflow end-to-end** - 45 min
6. **Fix any inspection issues** - 30 min
7. **Polish UI/UX** - 30 min
8. **Final testing** - 30 min
9. **Documentation update** - 20 min

**Total estimated time**: ~4.5 hours

---

**Let's get started!** 🚀

