'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Search, Filter, CheckCircle2, Clock, AlertTriangle, Trash2, FileDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { MessageReportData } from '@/types/messages';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function MessagesReportView() {
  const [messages, setMessages] = useState<MessageReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedMessage, setSelectedMessage] = useState<MessageReportData | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<{id: string; subject: string} | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchReports();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter]);

  async function fetchReports() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter && typeFilter !== 'all') params.append('type', typeFilter);
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);

      const response = await fetch(`/api/messages/reports?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!messageToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/messages/${messageToDelete.id}/delete`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete message');
      }

      toast.success('Message deleted successfully');
      setDeleteDialogOpen(false);
      setMessageToDelete(null);
      
      // Refresh reports
      fetchReports();
      
      // Close detail view if it was showing the deleted message
      if (selectedMessage?.message.id === messageToDelete.id) {
        setShowDetail(false);
        setSelectedMessage(null);
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete message');
    } finally {
      setDeleting(false);
    }
  }

  async function handleExportPDF(messageId: string, subject: string) {
    try {
      toast.loading('Generating PDF report...');
      
      const response = await fetch(`/api/messages/${messageId}/export`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate PDF');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Toolbox_Talk_${subject.replace(/[^a-z0-9]/gi, '_')}_Report.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.dismiss();
      toast.success('PDF report downloaded successfully');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.dismiss();
      toast.error(error instanceof Error ? error.message : 'Failed to export PDF');
    }
  }

  const filteredMessages = messages.filter(msg =>
    msg.message.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.message.sender_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by subject or sender..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="TOOLBOX_TALK">Toolbox Talks</SelectItem>
            <SelectItem value="REMINDER">Reminders</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="signed">Fully Signed</SelectItem>
            <SelectItem value="pending">Has Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Messages List */}
      {filteredMessages.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No messages found
        </Card>
      ) : showDetail && selectedMessage ? (
        /* Detail View */
        <div className="space-y-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowDetail(false);
              setSelectedMessage(null);
            }}
            className="mb-2"
          >
            ← Back to List
          </Button>

          <Card className="p-6">
            <div className="space-y-4">
              {/* Message Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xl font-bold text-foreground">
                      {selectedMessage.message.subject}
                    </h3>
                    <Badge variant={selectedMessage.message.type === 'TOOLBOX_TALK' ? 'destructive' : 'default'}>
                      {selectedMessage.message.type === 'TOOLBOX_TALK' ? 'Toolbox Talk' : 'Reminder'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    From: {selectedMessage.message.sender_name} • {formatDistanceToNow(new Date(selectedMessage.message.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMessageToDelete({
                        id: selectedMessage.message.id,
                        subject: selectedMessage.message.subject
                      });
                      setDeleteDialogOpen(true);
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {selectedMessage.message.type === 'TOOLBOX_TALK' && (
                    <Button
                      size="sm"
                      onClick={() => handleExportPDF(selectedMessage.message.id, selectedMessage.message.subject)}
                      className="bg-red-600 hover:bg-red-700 text-white gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download Report
                    </Button>
                  )}
                </div>
              </div>

              {/* Stats */}
              {selectedMessage.message.type === 'TOOLBOX_TALK' ? (
                <div className="grid grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Assigned</p>
                    <p className="text-2xl font-bold text-foreground">{selectedMessage.total_assigned}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Signed</p>
                    <p className="text-2xl font-bold text-green-600">{selectedMessage.total_signed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold text-orange-600">{selectedMessage.total_pending}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Compliance</p>
                    <p className="text-2xl font-bold text-foreground">{selectedMessage.compliance_rate}%</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Assigned</p>
                    <p className="text-2xl font-bold text-foreground">{selectedMessage.total_assigned}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dismissed</p>
                    <p className="text-2xl font-bold text-green-600">{selectedMessage.total_signed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Not Viewed</p>
                    <p className="text-2xl font-bold text-orange-600">{selectedMessage.total_pending}</p>
                  </div>
                </div>
              )}

              {/* Message Body */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">Message:</h4>
                <div className="p-4 bg-white dark:bg-slate-900 border border-border rounded whitespace-pre-wrap text-sm">
                  {selectedMessage.message.body}
                </div>
              </div>

              {/* Recipients Table */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">Recipients ({selectedMessage.recipients.length}):</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        {selectedMessage.message.type === 'TOOLBOX_TALK' ? 'Signed At' : 'Dismissed At'}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedMessage.recipients.map((recipient) => (
                      <TableRow key={recipient.id}>
                        <TableCell className="font-medium">
                          {recipient.user?.full_name || 'Deleted User'}
                          {recipient.user?.employee_id && (
                            <span className="text-xs text-muted-foreground ml-2">({recipient.user.employee_id})</span>
                          )}
                        </TableCell>
                        <TableCell className="capitalize">{recipient.user?.role || '-'}</TableCell>
                        <TableCell>
                          {recipient.status === 'SIGNED' ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Signed
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <Clock className="h-3 w-3" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {recipient.signed_at
                            ? formatDistanceToNow(new Date(recipient.signed_at), { addSuffix: true })
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        /* List View */
        <div className="space-y-3">
          {filteredMessages.map((msg) => (
            <Card
              key={msg.message.id}
              className="p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => {
                setSelectedMessage(msg);
                setShowDetail(true);
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-foreground">{msg.message.subject}</h4>
                    <Badge variant={msg.message.type === 'TOOLBOX_TALK' ? 'destructive' : 'default'}>
                      {msg.message.type === 'TOOLBOX_TALK' ? 'Toolbox Talk' : 'Reminder'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    From: {msg.message.sender_name} • {formatDistanceToNow(new Date(msg.message.created_at), { addSuffix: true })}
                  </p>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      <strong>{msg.total_assigned}</strong> assigned
                    </span>
                    {msg.message.type === 'TOOLBOX_TALK' ? (
                      <>
                        <span className="text-green-600">
                          <CheckCircle2 className="h-4 w-4 inline mr-1" />
                          <strong>{msg.total_signed}</strong> signed
                        </span>
                        {msg.total_pending > 0 && (
                          <span className="text-orange-600">
                            <AlertTriangle className="h-4 w-4 inline mr-1" />
                            <strong>{msg.total_pending}</strong> pending
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {msg.compliance_rate}% compliance
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-green-600">
                          <CheckCircle2 className="h-4 w-4 inline mr-1" />
                          <strong>{msg.total_signed}</strong> dismissed
                        </span>
                        {msg.total_pending > 0 && (
                          <span className="text-orange-600">
                            <Clock className="h-4 w-4 inline mr-1" />
                            <strong>{msg.total_pending}</strong> not viewed
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMessageToDelete({
                        id: msg.message.id,
                        subject: msg.message.subject
                      });
                      setDeleteDialogOpen(true);
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {msg.message.type === 'TOOLBOX_TALK' && (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportPDF(msg.message.id, msg.message.subject);
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download Report
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{messageToDelete?.subject}&quot;?
              <br /><br />
              This will immediately remove the message from all unsigned employees&apos; queues. Signed records will be kept for audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

