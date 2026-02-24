'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Upload, File, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { validateRAMSFile, formatFileSize } from '@/lib/utils/file-validation';
import type { ProjectDocumentType } from '@/types/rams';

interface UploadRAMSModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  prefillTitle?: string;
  prefillDescription?: string;
  prefillTypeId?: string;
}

export function UploadRAMSModal({ open, onClose, onSuccess, prefillTitle, prefillDescription, prefillTypeId }: UploadRAMSModalProps) {
  const [title, setTitle] = useState(prefillTitle || '');
  const [description, setDescription] = useState(prefillDescription || '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [documentTypes, setDocumentTypes] = useState<ProjectDocumentType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>(prefillTypeId || '');
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    if (open) {
      fetch('/api/projects/document-types')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            const active = data.types.filter((t: ProjectDocumentType) => t.is_active);
            setDocumentTypes(active);
            if (!selectedTypeId && active.length > 0) {
              setSelectedTypeId(active[0].id);
            }
          }
        })
        .catch(err => console.error('Error loading document types:', err));
    }
  }, [open]);

  useEffect(() => {
    if (prefillTitle) setTitle(prefillTitle);
    if (prefillDescription) setDescription(prefillDescription);
    if (prefillTypeId) setSelectedTypeId(prefillTypeId);
  }, [prefillTitle, prefillDescription, prefillTypeId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validation = validateRAMSFile(selectedFile);
    if (!validation.valid) {
      toast.error(validation.error);
      e.target.value = '';
      return;
    }

    setFile(selectedFile);
  };

  const handleRemoveFile = () => {
    setFile(null);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const resetForm = useCallback(() => {
    setTitle(prefillTitle || '');
    setDescription(prefillDescription || '');
    setFile(null);
    setUploadProgress(0);
    if (!prefillTypeId && documentTypes.length > 0) {
      setSelectedTypeId(documentTypes[0].id);
    }
  }, [prefillTitle, prefillDescription, prefillTypeId, documentTypes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !title.trim()) {
      toast.error('Please provide a title and select a file');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    if (description.trim()) {
      formData.append('description', description.trim());
    }
    if (selectedTypeId) {
      formData.append('document_type_id', selectedTypeId);
    }

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.addEventListener('progress', (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setUploadProgress(pct);
      }
    });

    xhr.addEventListener('load', () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success('Document uploaded successfully');
        resetForm();
        onSuccess();
      } else {
        let errorMsg = 'Failed to upload document';
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.error) errorMsg = data.error;
        } catch { /* use default */ }
        toast.error(errorMsg);
      }
      setUploading(false);
      setUploadProgress(0);
    });

    xhr.addEventListener('error', () => {
      xhrRef.current = null;
      toast.error('Upload failed. Please check your connection and try again.');
      setUploading(false);
      setUploadProgress(0);
    });

    xhr.addEventListener('abort', () => {
      xhrRef.current = null;
      setUploading(false);
      setUploadProgress(0);
    });

    xhr.open('POST', '/api/rams/upload');
    xhr.send(formData);
  };

  const handleClose = () => {
    if (uploading) return;
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a project document to share with employees
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Document Type */}
            {documentTypes.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="document-type">
                  Document Type <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a document type" />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="title">
                Document Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g., Site Safety Induction"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
                required
                className=""
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="Add additional information about this document..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={uploading}
                rows={3}
                className=""
              />
            </div>

            {/* File Upload */}
            <div className="grid gap-2">
              <Label htmlFor="file-upload">
                Upload File <span className="text-destructive">*</span>
              </Label>
              <p className="text-sm text-muted-foreground">
                PDF only, maximum 10MB
              </p>

              {!file ? (
                <div className="relative">
                  <Input
                    id="file-upload"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById('file-upload')?.click()}
                    disabled={uploading}
                    className="w-full h-24 border-2 border-dashed border-rams/40 hover:border-rams hover:bg-rams/5 text-slate-600 dark:text-muted-foreground hover:text-rams transition-all duration-200"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8" />
                      <span className="font-medium">Choose file to upload</span>
                      <span className="text-xs text-muted-foreground">Click to browse</span>
                    </div>
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/50 overflow-hidden">
                  <File className="h-8 w-8 text-primary shrink-0" />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-sm font-medium truncate overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveFile}
                    disabled={uploading}
                    className="shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Upload Progress */}
            {uploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Uploading...</span>
                  <span className="font-medium text-foreground">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                {uploadProgress === 100 && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Processing document...</span>
                  </div>
                )}
              </div>
            )}

            {!uploading && (
              <div className="rounded-md bg-blue-900/20 border border-blue-800/30 p-3">
                <p className="text-sm text-blue-100">
                  After uploading, you can assign this document to specific employees
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={uploading || !file || !title.trim()}
              className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

