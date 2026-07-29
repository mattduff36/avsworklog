'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SearchInput } from '@/components/ui/search-input';
import { fetchUserDirectory, type DirectoryUser } from '@/lib/client/user-directory';
import { cn } from '@/lib/utils/cn';

export interface NicknameUserComboboxProps {
  id?: string;
  value: string;
  selectedUserId: string | null;
  onNicknameChange: (nickname: string) => void;
  onUserSelect: (user: { id: string; fullName: string } | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  helperText?: string;
}

export function NicknameUserCombobox({
  id,
  value,
  selectedUserId,
  onNicknameChange,
  onUserSelect,
  placeholder = 'Type a nickname or pick a user',
  disabled = false,
  className,
  inputClassName,
  helperText = 'Type a nickname, or pick a user to link this asset.',
}: NicknameUserComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingUsers(true);
        setLoadError('');
        const directoryUsers = await fetchUserDirectory({ limit: 500 });
        if (!cancelled) {
          setUsers(directoryUsers.filter((user) => !user.full_name?.includes('(Deleted User)')));
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const filteredUsers = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return users.slice(0, 20);
    return users
      .filter((user) => {
        const name = (user.full_name || '').toLowerCase();
        const employeeId = (user.employee_id || '').toLowerCase();
        return name.includes(query) || employeeId.includes(query);
      })
      .slice(0, 20);
  }, [users, value]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [value, open]);

  function handleNicknameInput(nextValue: string) {
    onNicknameChange(nextValue);
    if (selectedUserId) {
      onUserSelect(null);
    }
    setOpen(true);
  }

  function handleSelectUser(user: DirectoryUser) {
    const fullName = user.full_name?.trim() || '';
    onNicknameChange(fullName);
    onUserSelect({ id: user.id, fullName });
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(index + 1, Math.max(filteredUsers.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && filteredUsers[highlightIndex]) {
      event.preventDefault();
      handleSelectUser(filteredUsers[highlightIndex]);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative space-y-1', className)}>
      <SearchInput
        id={id}
        value={value}
        onChange={(event) => handleNicknameInput(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        containerClassName={cn('bg-input border-border', inputClassName)}
        className="text-white placeholder:text-slate-500"
        aria-label={placeholder}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {helperText ? <p className="text-xs text-slate-400">{helperText}</p> : null}
      {selectedUserId ? (
        <p className="text-xs text-emerald-400">Linked user selected — assignment will update on save.</p>
      ) : null}
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Users"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-700 bg-slate-950 shadow-lg"
        >
          {loadingUsers ? (
            <p className="px-3 py-2 text-sm text-slate-400">Loading users...</p>
          ) : loadError ? (
            <p className="px-3 py-2 text-sm text-red-400">{loadError}</p>
          ) : filteredUsers.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No matching users. Free-text nickname is allowed.</p>
          ) : (
            filteredUsers.map((user, index) => {
              const label = user.full_name || 'Unnamed user';
              const isActive = index === highlightIndex;
              const isSelected = user.id === selectedUserId;
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-left text-sm text-white hover:bg-slate-800',
                    isActive && 'bg-slate-800',
                    isSelected && 'text-emerald-300'
                  )}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => handleSelectUser(user)}
                >
                  <span>{label}</span>
                  {user.employee_id ? (
                    <span className="text-xs text-slate-400">{user.employee_id}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
