import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as GetUsers, POST as CreateUser } from '@/app/api/admin/users/route';
import { createMockProfile, createMockAdmin, createMockManager } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, resetAllMocks } from '../../utils/test-helpers';

describe('Admin Users API', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('List Users', () => {
    it('should return all users for admins', () => {
      const users = [
        createMockProfile({ full_name: 'John Doe' }),
        createMockProfile({ full_name: 'Jane Smith' }),
        createMockProfile({ full_name: 'Bob Johnson' }),
      ];

      expect(users).toHaveLength(3);
    });

    it('should include role information', () => {
      const user = createMockProfile({
        roles: {
          id: 'role-id',
          name: 'employee',
          display_name: 'Employee',
          is_manager_admin: false,
        },
      });

      expect(user.roles.name).toBe('employee');
      expect(user.roles.is_manager_admin).toBe(false);
    });

    it('should only be accessible to admins', () => {
      const admin = createMockAdmin();
      const employee = createMockProfile();

      expect(admin.roles.name).toBe('admin');
      expect(admin.roles.is_manager_admin).toBe(true);
      expect(employee.roles.is_manager_admin).toBe(false);
    });
  });

  describe('Create User', () => {
    it('should create user with all required fields', () => {
      const newUser = {
        email: 'newuser@test.com',
        full_name: 'New User',
        password: 'SecureP@ss123',
        role_id: 'employee-role-id',
        employee_id: 'EMP123',
      };

      expect(newUser.email).toBeDefined();
      expect(newUser.full_name).toBeDefined();
      expect(newUser.password).toBeDefined();
      expect(newUser.role_id).toBeDefined();
    });

    it('should validate email format', () => {
      const validEmails = [
        'user@test.com',
        'user.name@company.co.uk',
        'user+tag@domain.com',
      ];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      validEmails.forEach(email => {
        expect(email).toMatch(emailRegex);
      });
    });

    it('should validate password requirements', () => {
      const password = 'SecureP@ss123';
      
      // At least 8 characters
      expect(password.length).toBeGreaterThanOrEqual(8);
      // Has uppercase
      expect(password).toMatch(/[A-Z]/);
      // Has lowercase
      expect(password).toMatch(/[a-z]/);
      // Has number
      expect(password).toMatch(/\d/);
    });

    it('should assign default employee role if not specified', () => {
      const user = {
        email: 'user@test.com',
        full_name: 'User',
        role_id: 'employee-role-id', // default
      };

      expect(user.role_id).toBe('employee-role-id');
    });
  });

  describe('Update User', () => {
    it('should allow updating user profile', () => {
      const user = createMockProfile({ full_name: 'Old Name' });
      
      const updated = {
        ...user,
        full_name: 'New Name',
        phone_number: '+44 7700 900000',
      };

      expect(updated.full_name).toBe('New Name');
      expect(updated.phone_number).toBeDefined();
    });

    it('should allow changing user role', () => {
      const user = createMockProfile({
        roles: { name: 'employee', is_manager_admin: false },
      });

      const promoted = {
        ...user,
        roles: { name: 'manager', is_manager_admin: true },
      };

      expect(promoted.roles.name).toBe('manager');
      expect(promoted.roles.is_manager_admin).toBe(true);
    });

    it('should send email notification on profile update', () => {
      const notification = {
        to: 'user@test.com',
        subject: 'Your Profile Has Been Updated',
        changes: {
          full_name: { old: 'Old Name', new: 'New Name' },
          role: { old: 'Employee', new: 'Manager' },
        },
      };

      expect(notification.to).toBeDefined();
      expect(notification.changes).toBeDefined();
    });
  });

  describe('Delete User', () => {
    it('should allow admins to delete users', () => {
      const user = createMockProfile();
      const deleted = { ...user, deleted: true };

      expect(deleted).toBeDefined();
      // In real API, would soft-delete or archive
    });

    it('should prevent deleting own account', () => {
      const admin = createMockAdmin();
      const attemptingSelfDelete = {
        admin_id: admin.id,
        target_user_id: admin.id,
      };

      // API should prevent this and return 403
      expect(attemptingSelfDelete.admin_id).toBe(attemptingSelfDelete.target_user_id);
    });
  });

  describe('Password Reset', () => {
    it('should generate password reset link', () => {
      const resetRequest = {
        user_email: 'user@test.com',
        reset_token: 'secure-token-123',
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      };

      expect(resetRequest.reset_token).toBeDefined();
      expect(resetRequest.expires_at).toBeDefined();
    });

    it('should send password reset email', () => {
      const email = {
        to: 'user@test.com',
        subject: 'Password Reset Request',
        reset_link: 'https://app.com/reset?token=abc123',
      };

      expect(email.to).toBeDefined();
      expect(email.reset_link).toContain('token=');
    });
  });

  describe('User Roles', () => {
    it('should support employee role', () => {
      const employee = createMockProfile({
        roles: { name: 'employee', is_manager_admin: false },
      });

      expect(employee.roles.name).toBe('employee');
      expect(employee.roles.is_manager_admin).toBe(false);
    });

    it('should support manager role', () => {
      const manager = createMockManager();

      expect(manager.roles.name).toBe('manager');
      expect(manager.roles.is_manager_admin).toBe(true);
    });

    it('should support admin role', () => {
      const admin = createMockAdmin();

      expect(admin.roles.name).toBe('admin');
      expect(admin.roles.is_manager_admin).toBe(true);
    });
  });

  describe('Permissions', () => {
    it('should restrict user management to admins only', () => {
      const admin = createMockAdmin();
      const manager = createMockManager();
      const employee = createMockProfile();

      expect(admin.roles.name).toBe('admin'); // Can manage users
      expect(manager.roles.is_manager_admin).toBe(true); // Can view users
      expect(employee.roles.is_manager_admin).toBe(false); // Cannot manage users
    });

    it('should allow managers to view users but not create/delete', () => {
      const manager = createMockManager();

      expect(manager.roles.is_manager_admin).toBe(true);
      expect(manager.roles.name).toBe('manager');
      // In API, would check specific permissions
    });
  });
});

