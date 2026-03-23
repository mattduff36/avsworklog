'use client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown, Users } from 'lucide-react';

export interface TeamToggleOption {
  id: string;
  name: string;
  hasAccess: boolean;
  selected: boolean;
}

interface TeamToggleMenuProps {
  allTeamsSelected: boolean;
  disabled?: boolean;
  onToggleAllTeams: () => void;
  onToggleTeam: (teamId: string) => void;
  selectedTeamCount: number;
  teams: TeamToggleOption[];
  triggerClassName: string;
  activeItemClassName: string;
  triggerLabel?: string;
}

export function TeamToggleMenu({
  allTeamsSelected,
  disabled = false,
  onToggleAllTeams,
  onToggleTeam,
  selectedTeamCount,
  teams,
  triggerClassName,
  activeItemClassName,
  triggerLabel = 'Select Teams',
}: TeamToggleMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={triggerClassName}
        >
          <Users className="mr-2 h-4 w-4" />
          {selectedTeamCount > 0
            ? `${selectedTeamCount} team${selectedTeamCount !== 1 ? 's' : ''} selected`
            : triggerLabel}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 border-slate-700 bg-slate-900 p-2 text-slate-100">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onToggleAllTeams}
            disabled={disabled}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
              allTeamsSelected ? activeItemClassName : 'hover:bg-slate-800'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <Users className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">All Teams</span>
            {allTeamsSelected && <Check className="h-4 w-4 flex-shrink-0" />}
          </button>
          <div className="max-h-56 space-y-1 overflow-y-auto border-t border-slate-700 pt-2">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => onToggleTeam(team.id)}
                disabled={!team.hasAccess}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                  team.selected ? activeItemClassName : 'hover:bg-slate-800'
                } ${!team.hasAccess ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <Users className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 truncate text-left">{team.name}</span>
                {!team.hasAccess ? (
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">No Access</span>
                ) : (
                  team.selected && <Check className="h-4 w-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
