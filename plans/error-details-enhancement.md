# Error Details Enhancement Plan

**Date:** January 22, 2026  
**Priority:** High  
**Status:** Planning  

---

## 📋 Overview

Enhance ALL error messages across the application to provide "Show Details" buttons where additional context would help users understand WHY an error occurred and HOW to resolve it.

---

## 🎯 Goals

1. **Transparency** - Users understand exactly why an action failed
2. **Actionability** - Users know exactly what to do to resolve the issue
3. **Consistency** - All contextual errors have the same UX pattern
4. **Performance** - Details loaded on-demand, not upfront

---

## 🔍 Error Categories That Need Details

### 1. **Deletion Prevented (Foreign Key Constraints)**

**Current State:**
```typescript
// ❌ Generic error, no details
toast.error("Cannot delete subcategory: it is referenced by existing tasks");
```

**Enhanced State:**
```typescript
// ✅ Error with details button
<ErrorWithDetails
  message="Cannot delete subcategory: it is referenced by existing tasks"
  detailsType="subcategory-tasks"
  itemId={subcategoryId}
/>
```

**Details Would Show:**
- List of tasks using the subcategory
- Task titles, statuses, and vehicles
- Links to each task
- Actions: "Reassign Tasks" or "Delete Tasks"

**Applies To:**
- Deleting categories with subcategories
- Deleting subcategories with tasks
- Deleting vehicles with active tasks
- Deleting users with assigned tasks
- Deleting attachment templates with responses
- Deleting message templates with pending messages

---

### 2. **Validation Failures (Business Logic)**

**Current State:**
```typescript
// ❌ Generic error
toast.error("Cannot complete task: required attachments not filled");
```

**Enhanced State:**
```typescript
<ErrorWithDetails
  message="Cannot complete task: required attachments not filled"
  detailsType="missing-attachments"
  itemId={taskId}
/>
```

**Details Would Show:**
- List of required attachments
- Completion status for each
- Missing questions/responses
- Direct link to fill each attachment

**Applies To:**
- Required attachments missing
- Required fields not filled
- Invalid mileage values
- Date conflicts
- Overlapping timesheets
- Insufficient permissions

---

### 3. **Permission Denied Errors**

**Current State:**
```typescript
// ❌ Vague error
toast.error("You don't have permission to perform this action");
```

**Enhanced State:**
```typescript
<ErrorWithDetails
  message="You don't have permission to perform this action"
  detailsType="permission-denied"
  requiredPermission="manage_workshop_tasks"
/>
```

**Details Would Show:**
- Required permission/role
- User's current role
- Who to contact for access
- Link to permissions documentation

**Applies To:**
- Admin-only actions
- Manager-only actions
- SuperAdmin-only actions
- Department-specific actions

---

### 4. **Resource Conflicts**

**Current State:**
```typescript
// ❌ Unclear conflict
toast.error("Vehicle is already assigned to another task");
```

**Enhanced State:**
```typescript
<ErrorWithDetails
  message="Vehicle is already assigned to another task"
  detailsType="vehicle-conflict"
  vehicleId={vehicleId}
  conflictingTaskId={existingTaskId}
/>
```

**Details Would Show:**
- Existing task details
- Task status and assignee
- Expected completion date
- Link to existing task
- Option to reassign or wait

**Applies To:**
- Vehicle assignment conflicts
- User availability conflicts
- Resource booking conflicts
- Duplicate entries

---

### 5. **Dependency Errors**

**Current State:**
```typescript
// ❌ Missing context
toast.error("Cannot archive vehicle: complete all tasks first");
```

**Enhanced State:**
```typescript
<ErrorWithDetails
  message="Cannot archive vehicle: complete all tasks first"
  detailsType="pending-tasks"
  vehicleId={vehicleId}
/>
```

**Details Would Show:**
- List of pending tasks
- Task priorities and due dates
- Assigned users
- Quick complete/cancel options
- Bulk actions

**Applies To:**
- Vehicle archival with pending tasks
- User deactivation with assignments
- Category changes with active items
- Status transitions with blockers

---

## 🛠️ Implementation Plan

### Phase 1: Core Infrastructure

**1.1 Create Error Details Component**
```typescript
// components/ui/error-with-details.tsx

interface ErrorWithDetailsProps {
  message: string;
  detailsType: 
    | 'subcategory-tasks'
    | 'missing-attachments'
    | 'permission-denied'
    | 'vehicle-conflict'
    | 'pending-tasks'
    | 'foreign-key-constraint'
    | 'validation-failure';
  itemId?: string;
  additionalData?: Record<string, any>;
  onResolve?: () => void; // Callback after user takes action
}

export function ErrorWithDetails({
  message,
  detailsType,
  itemId,
  additionalData,
  onResolve
}: ErrorWithDetailsProps) {
  // Toast notification with "Show Details" button
  // Modal/Dialog to display detailed information
  // Action buttons to help resolve the issue
}
```

**1.2 Create Details API Endpoints**
```typescript
// app/api/errors/details/[type]/route.ts

GET /api/errors/details/subcategory-tasks?id={subcategoryId}
GET /api/errors/details/missing-attachments?taskId={taskId}
GET /api/errors/details/permission-denied?action={action}
GET /api/errors/details/vehicle-conflict?vehicleId={vehicleId}
GET /api/errors/details/pending-tasks?vehicleId={vehicleId}
```

**1.3 Create Details Modal Component**
```typescript
// components/ui/error-details-modal.tsx

interface ErrorDetailsModalProps {
  open: boolean;
  onClose: () => void;
  detailsType: string;
  data: any;
  onAction?: (action: string, payload: any) => void;
}
```

---

### Phase 2: Update Existing Error Handlers

**2.1 Workshop Tasks Page**
- Subcategory deletion errors
- Category deletion errors
- Task assignment conflicts

**2.2 Fleet/Vehicles Pages**
- Vehicle archival errors
- Vehicle deletion errors
- Assignment conflicts

**2.3 Admin Pages**
- User deletion/deactivation errors
- Role assignment errors
- Permission denied errors

**2.4 Workshop Attachments**
- Attachment template deletion errors
- Required attachment validation errors
- Completion validation errors

**2.5 Messages**
- Template deletion errors
- Message conflicts
- Recipient validation errors

**2.6 Timesheets**
- Overlap errors
- Validation errors
- Approval conflicts

**2.7 RAMS**
- Template deletion errors
- Signing requirement errors
- Assignment conflicts

---

### Phase 3: Error Detail Types Implementation

**Priority Order:**

**High Priority (Implement First):**
1. ✅ `subcategory-tasks` - Deletion prevention
2. ✅ `pending-tasks` - Vehicle archival/status changes
3. ✅ `missing-attachments` - Task completion validation
4. ✅ `foreign-key-constraint` - Generic deletion prevention
5. ✅ `validation-failure` - Business logic violations

**Medium Priority:**
6. `permission-denied` - Access control errors
7. `vehicle-conflict` - Resource assignment conflicts
8. `user-assignment-conflict` - Schedule conflicts

**Low Priority (Nice to Have):**
9. `duplicate-entry` - Duplicate record warnings
10. `stale-data` - Concurrent modification warnings

---

## 📐 UI/UX Design

### Toast Notification Format
```
┌─────────────────────────────────────────────────┐
│ ⚠️  Cannot delete subcategory                   │
│                                                 │
│ It is referenced by existing tasks              │
│                                                 │
│ [Show Details]  [Dismiss]                       │
└─────────────────────────────────────────────────┘
```

### Details Modal Format
```
┌─────────────────────────────────────────────────────┐
│  Error Details                              [Close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Cannot delete "Basic Service" subcategory          │
│                                                     │
│  📋 Tasks Using This Subcategory (1)                │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  ✅ Workshop Task - YS23 KUN                        │
│     Status: Completed                               │
│     Vehicle: YS23 KUN (Adrian Spencer)              │
│     Created: 16/01/2026                             │
│     [View Task] [Reassign]                          │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  💡 How to Resolve:                                 │
│  • Reassign the task to a different subcategory     │
│  • Delete the task if no longer needed              │
│                                                     │
│  [Reassign All Tasks]  [Delete All Tasks]  [Close] │
└─────────────────────────────────────────────────────┘
```

---

## 🔌 API Response Format

### Error Details API Response
```typescript
// GET /api/errors/details/subcategory-tasks?id={id}

{
  "success": true,
  "detailsType": "subcategory-tasks",
  "summary": {
    "subcategoryName": "Basic Service",
    "totalTasks": 1,
    "statusBreakdown": {
      "completed": 1,
      "pending": 0,
      "logged": 0
    }
  },
  "items": [
    {
      "id": "3f6f0866-64ad-465f-92dc-f24a1ec12452",
      "title": "Workshop Task - YS23 KUN",
      "status": "completed",
      "vehicle": {
        "reg_number": "YS23 KUN",
        "nickname": "Adrian Spencer"
      },
      "created_at": "2026-01-16",
      "url": "/workshop-tasks?task=3f6f0866-64ad-465f-92dc-f24a1ec12452"
    }
  ],
  "actions": [
    {
      "id": "reassign-all",
      "label": "Reassign All Tasks",
      "type": "primary",
      "endpoint": "/api/workshop-tasks/bulk-reassign"
    },
    {
      "id": "delete-completed",
      "label": "Delete Completed Tasks",
      "type": "destructive",
      "endpoint": "/api/workshop-tasks/bulk-delete"
    }
  ],
  "resolutionGuide": [
    "Reassign the task to a different subcategory",
    "Delete the task if no longer needed",
    "Complete any pending tasks first"
  ]
}
```

---

## 📝 Implementation Checklist

### Phase 1: Infrastructure (Week 1)
- [ ] Create `ErrorWithDetails` component
- [ ] Create `ErrorDetailsModal` component
- [ ] Create base API route structure
- [ ] Add types/interfaces
- [ ] Create utility functions
- [ ] Add unit tests

### Phase 2: High Priority Errors (Week 2)
- [ ] Implement `subcategory-tasks` details
- [ ] Implement `pending-tasks` details
- [ ] Implement `missing-attachments` details
- [ ] Implement `foreign-key-constraint` details
- [ ] Implement `validation-failure` details

### Phase 3: Integration (Week 3)
- [ ] Update Workshop Tasks page
- [ ] Update Fleet/Vehicles pages
- [ ] Update Admin pages
- [ ] Update Workshop Attachments
- [ ] Update Messages
- [ ] Update Timesheets
- [ ] Update RAMS

### Phase 4: Medium Priority (Week 4)
- [ ] Implement `permission-denied` details
- [ ] Implement `vehicle-conflict` details
- [ ] Implement `user-assignment-conflict` details

### Phase 5: Testing & Polish (Week 5)
- [ ] Integration tests
- [ ] E2E tests
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] Documentation
- [ ] User training materials

---

## 🎨 Styling Guidelines

### Colors
- Error state: `text-red-600 dark:text-red-400`
- Warning state: `text-amber-600 dark:text-amber-400`
- Info state: `text-blue-600 dark:text-blue-400`
- Success state: `text-green-600 dark:text-green-400`

### Icons
- Error: `AlertTriangle`, `XCircle`
- Info: `Info`, `HelpCircle`
- Action: `ExternalLink`, `ArrowRight`
- Close: `X`

### Button Variants
- Primary Action: `variant="default"`
- Secondary Action: `variant="outline"`
- Destructive Action: `variant="destructive"`
- Dismiss: `variant="ghost"`

---

## 📊 Success Metrics

### User Experience
- **Reduced support tickets** - Fewer "why can't I delete X?" questions
- **Faster resolution** - Users resolve issues without help
- **Increased confidence** - Users understand system constraints

### Technical Metrics
- **Error resolution rate** - % of errors users resolve via details
- **Details view rate** - % of errors where users click "Show Details"
- **Action completion rate** - % of users who take suggested actions

### Target Metrics
- 80% of deletion errors should have details
- 60% of users should click "Show Details"
- 70% of users who see details should resolve the issue

---

## 🔄 Future Enhancements

### Phase 6: Advanced Features (Future)
- **Bulk Resolution** - Resolve multiple conflicts at once
- **Smart Suggestions** - AI-powered resolution recommendations
- **Error Prevention** - Warn users BEFORE action fails
- **Error History** - Track and learn from common errors
- **Contextual Help** - In-app documentation for each error type

### Phase 7: Analytics & Insights
- **Error Dashboard** - Admin view of common errors
- **Error Trends** - Track error patterns over time
- **User Impact** - Measure support ticket reduction
- **Resolution Paths** - Analyze how users resolve errors

---

## 📚 Related Documentation

- Error Handling Best Practices
- Toast Notification Guidelines
- Modal Dialog Standards
- API Response Format Guide
- User Permission System
- Database Constraints Reference

---

## 🎯 Quick Win: Subcategory Tasks Detail

**Immediate Implementation (Today):**

Since we already have the `find-subcategory-tasks.ts` script, we can quickly add this as the FIRST error detail type:

1. Create API endpoint: `/api/errors/details/subcategory-tasks`
2. Update subcategory deletion handler in `workshop-tasks/page.tsx`
3. Add simple alert dialog showing tasks
4. Test with "Basic Service" deletion

**Estimated Time:** 2-3 hours  
**Impact:** Immediate user benefit  
**Complexity:** Low  

---

**Next Steps:**
1. Review and approve this plan
2. Create TODOs for Phase 1
3. Start with Quick Win implementation
4. Iterate based on user feedback
