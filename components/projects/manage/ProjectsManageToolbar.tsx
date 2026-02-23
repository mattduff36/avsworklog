'use client';

import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { Upload, Settings } from 'lucide-react';
import Link from 'next/link';

interface ProjectsManageToolbarProps {
  onUploadClick: () => void;
}

export function ProjectsManageToolbar({ onUploadClick }: ProjectsManageToolbarProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground truncate">
              Manage Projects
            </h1>
            <p className="text-sm text-muted-foreground hidden sm:block">
              Upload, search, and manage project documents
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href="/projects/settings">
            <Button
              variant="outline"
              size="sm"
              className="border-border text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Settings</span>
            </Button>
          </Link>
          <Button
            onClick={onUploadClick}
            size="sm"
            className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
          >
            <Upload className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Upload Document</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
