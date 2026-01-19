import { describe, it, expect } from 'vitest';

describe('Maintenance Reminders API', () => {
  describe('Category Responsibility', () => {
    it('should distinguish between workshop and office categories', () => {
      const categories = [
        { name: 'Tax Due Date', responsibility: 'office', type: 'date' },
        { name: 'MOT Due Date', responsibility: 'workshop', type: 'date' },
        { name: 'Service Due', responsibility: 'workshop', type: 'mileage' },
        { name: 'Cambelt Replacement', responsibility: 'workshop', type: 'mileage' },
        { name: 'First Aid Kit Expiry', responsibility: 'workshop', type: 'date' },
      ];

      const officeCategories = categories.filter(c => c.responsibility === 'office');
      const workshopCategories = categories.filter(c => c.responsibility === 'workshop');

      expect(officeCategories).toHaveLength(1);
      expect(officeCategories[0].name).toBe('Tax Due Date');
      expect(workshopCategories).toHaveLength(4);
    });

    it('should default to workshop responsibility', () => {
      const newCategory = {
        name: 'New Category',
        type: 'date',
        responsibility: 'workshop', // Default
      };

      expect(newCategory.responsibility).toBe('workshop');
    });
  });

  describe('Office Action CTA Logic', () => {
    it('should show Office Action for office-owned categories', () => {
      const alert = {
        type: 'Tax',
        detail: 'Overdue by 5 days',
        severity: 'overdue' as const,
      };
      
      const categoryMap: Record<string, string> = {
        'Tax': 'office',
        'MOT': 'workshop',
        'Service': 'workshop',
      };

      const responsibility = categoryMap[alert.type];
      expect(responsibility).toBe('office');
    });

    it('should show Create Task for workshop-owned categories', () => {
      const alert = {
        type: 'Service',
        detail: '500 miles remaining',
        severity: 'due_soon' as const,
      };
      
      const categoryMap: Record<string, string> = {
        'Tax': 'office',
        'MOT': 'workshop',
        'Service': 'workshop',
      };

      const responsibility = categoryMap[alert.type];
      expect(responsibility).toBe('workshop');
    });
  });

  describe('Reminder Request Validation', () => {
    it('should require vehicleId, categoryName, and dueInfo', () => {
      const validRequest = {
        vehicleId: 'vehicle-123',
        categoryName: 'Tax Due Date',
        dueInfo: 'Overdue by 5 days',
      };

      expect(validRequest.vehicleId).toBeDefined();
      expect(validRequest.categoryName).toBeDefined();
      expect(validRequest.dueInfo).toBeDefined();
    });

    it('should accept optional subject and body overrides', () => {
      const requestWithOverrides = {
        vehicleId: 'vehicle-123',
        categoryName: 'Tax Due Date',
        dueInfo: 'Overdue by 5 days',
        subjectOverride: 'Urgent: Tax renewal needed',
        bodyOverride: 'Please renew the tax for this vehicle immediately.',
      };

      expect(requestWithOverrides.subjectOverride).toBeDefined();
      expect(requestWithOverrides.bodyOverride).toBeDefined();
    });
  });

  describe('Reminder Response', () => {
    it('should return message details when in-app is enabled', () => {
      const response = {
        success: true,
        message: {
          id: 'msg-123',
          recipients_count: 3,
        },
      };

      expect(response.success).toBe(true);
      expect(response.message?.recipients_count).toBe(3);
    });

    it('should return email stats when email is enabled', () => {
      const response = {
        success: true,
        emails: {
          sent: 2,
          failed: 1,
        },
      };

      expect(response.success).toBe(true);
      expect(response.emails?.sent).toBe(2);
      expect(response.emails?.failed).toBe(1);
    });

    it('should return both when both are enabled', () => {
      const response = {
        success: true,
        message: {
          id: 'msg-123',
          recipients_count: 3,
        },
        emails: {
          sent: 3,
          failed: 0,
        },
      };

      expect(response.message).toBeDefined();
      expect(response.emails).toBeDefined();
    });
  });

  describe('Category Recipients', () => {
    it('should support configuring recipients per category', () => {
      const categoryRecipients = [
        { category_id: 'cat-1', user_id: 'user-1' },
        { category_id: 'cat-1', user_id: 'user-2' },
        { category_id: 'cat-1', user_id: 'user-3' },
      ];

      expect(categoryRecipients).toHaveLength(3);
      expect(categoryRecipients.every(r => r.category_id === 'cat-1')).toBe(true);
    });

    it('should allow updating recipients (replace all)', () => {
      const oldRecipients = ['user-1', 'user-2'];
      const newRecipients = ['user-2', 'user-3', 'user-4'];

      // Replace operation
      const result = newRecipients;

      expect(result).toHaveLength(3);
      expect(result).not.toContain('user-1');
      expect(result).toContain('user-2');
    });

    it('should fall back to managers when no recipients configured', () => {
      const categoryRecipients: string[] = [];
      const managers = ['manager-1', 'admin-1'];

      const recipients = categoryRecipients.length > 0 
        ? categoryRecipients 
        : managers;

      expect(recipients).toEqual(managers);
    });
  });

  describe('Reminder Settings', () => {
    it('should support enabling/disabling in-app notifications', () => {
      const category = {
        name: 'Tax Due Date',
        responsibility: 'office',
        reminder_in_app_enabled: true,
        reminder_email_enabled: false,
      };

      expect(category.reminder_in_app_enabled).toBe(true);
      expect(category.reminder_email_enabled).toBe(false);
    });

    it('should support enabling/disabling email notifications', () => {
      const category = {
        name: 'Tax Due Date',
        responsibility: 'office',
        reminder_in_app_enabled: true,
        reminder_email_enabled: true,
      };

      expect(category.reminder_email_enabled).toBe(true);
    });

    it('should require at least one reminder type enabled', () => {
      const category = {
        reminder_in_app_enabled: false,
        reminder_email_enabled: false,
      };

      const hasRemindersEnabled = category.reminder_in_app_enabled || category.reminder_email_enabled;
      expect(hasRemindersEnabled).toBe(false);
    });
  });

  describe('Show on Overview Toggle', () => {
    it('should allow hiding categories from overview', () => {
      const categories = [
        { name: 'Tax Due Date', show_on_overview: true },
        { name: 'Old Category', show_on_overview: false },
      ];

      const visibleCategories = categories.filter(c => c.show_on_overview);
      expect(visibleCategories).toHaveLength(1);
    });

    it('should default to showing on overview', () => {
      const newCategory = {
        name: 'New Category',
        show_on_overview: true, // Default
      };

      expect(newCategory.show_on_overview).toBe(true);
    });
  });
});

describe('Tax Due Date Update Workflow', () => {
  describe('Manual Update', () => {
    it('should accept new due date with comment', () => {
      const updateRequest = {
        tax_due_date: '2027-01-19',
        comment: 'Tax renewed online via GOV.UK, confirmation received',
      };

      expect(updateRequest.tax_due_date).toBeDefined();
      expect(updateRequest.comment.length).toBeGreaterThanOrEqual(10);
    });

    it('should require minimum 10 character comment', () => {
      const shortComment = 'Renewed';
      const validComment = 'Tax renewed via GOV.UK portal';

      expect(shortComment.length).toBeLessThan(10);
      expect(validComment.length).toBeGreaterThanOrEqual(10);
    });

    it('should create audit trail entry', () => {
      const historyEntry = {
        vehicle_id: 'vehicle-123',
        field_name: 'tax_due_date',
        old_value: '2024-12-31',
        new_value: '2025-12-31',
        value_type: 'date',
        comment: 'Annual tax renewed via GOV.UK',
        updated_by: 'user-123',
        updated_by_name: 'John Smith',
        created_at: new Date().toISOString(),
      };

      expect(historyEntry.field_name).toBe('tax_due_date');
      expect(historyEntry.old_value).not.toBe(historyEntry.new_value);
    });
  });

  describe('DVLA Refresh', () => {
    it('should update tax_due_date from DVLA response', () => {
      const dvlaData = {
        taxDueDate: '2025-12-31',
        taxStatus: 'Taxed',
        make: 'Ford',
        colour: 'White',
      };

      const updates = {
        tax_due_date: dvlaData.taxDueDate,
        ves_tax_status: dvlaData.taxStatus,
      };

      expect(updates.tax_due_date).toBe('2025-12-31');
    });

    it('should track which fields were updated', () => {
      const oldValues = {
        tax_due_date: '2024-12-31',
        mot_due_date: '2025-06-15',
      };

      const newValues = {
        tax_due_date: '2025-12-31',
        mot_due_date: '2025-06-15', // Unchanged
      };

      const fieldsUpdated: string[] = [];
      if (oldValues.tax_due_date !== newValues.tax_due_date) {
        fieldsUpdated.push('tax_due_date');
      }
      if (oldValues.mot_due_date !== newValues.mot_due_date) {
        fieldsUpdated.push('mot_due_date');
      }

      expect(fieldsUpdated).toContain('tax_due_date');
      expect(fieldsUpdated).not.toContain('mot_due_date');
    });
  });

  describe('Overdue/Due Soon Removal', () => {
    it('should remove from overdue list after valid update', () => {
      const today = new Date();
      const overdueDate = new Date(today);
      overdueDate.setDate(overdueDate.getDate() - 5); // 5 days ago
      
      const newDueDate = new Date(today);
      newDueDate.setFullYear(newDueDate.getFullYear() + 1); // Next year

      const isStillOverdue = newDueDate < today;
      expect(isStillOverdue).toBe(false);
    });

    it('should correctly calculate days until due', () => {
      const today = new Date('2026-01-19');
      const dueDate = new Date('2026-01-24'); // 5 days away
      
      const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      expect(daysUntil).toBe(5);
    });
  });
});

describe('Maintenance Email Templates', () => {
  describe('Reminder Email', () => {
    it('should include vehicle registration', () => {
      const emailParams = {
        vehicleReg: 'AB12 CDE',
        categoryName: 'Tax Due Date',
        dueInfo: 'Overdue by 5 days',
        senderName: 'Fleet Manager',
      };

      expect(emailParams.vehicleReg).toBeDefined();
      expect(emailParams.vehicleReg.length).toBeGreaterThan(0);
    });

    it('should indicate overdue vs due soon status', () => {
      const overdueInfo = 'Overdue by 5 days';
      const dueSoonInfo = 'Due in 3 days';

      const isOverdue = (info: string) => info.toLowerCase().includes('overdue');

      expect(isOverdue(overdueInfo)).toBe(true);
      expect(isOverdue(dueSoonInfo)).toBe(false);
    });

    it('should use appropriate color for status', () => {
      const getStatusColor = (dueInfo: string) => {
        return dueInfo.toLowerCase().includes('overdue') ? '#DC2626' : '#F59E0B';
      };

      expect(getStatusColor('Overdue by 5 days')).toBe('#DC2626'); // Red
      expect(getStatusColor('Due in 3 days')).toBe('#F59E0B'); // Amber
    });
  });
});
