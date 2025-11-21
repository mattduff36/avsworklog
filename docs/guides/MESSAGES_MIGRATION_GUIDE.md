# Messages System Migration Guide

## Running the Migration

Due to SSL certificate requirements, this migration should be run directly in the Supabase Dashboard.

### Steps:

1. Go to your Supabase Dashboard
2. Navigate to: **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `supabase/create-messages-tables.sql`
5. Paste into the SQL Editor
6. Click **Run** (or press Cmd/Ctrl + Enter)

### What Gets Created:

- **messages** table: Stores Toolbox Talk and Reminder messages
- **message_recipients** table: Tracks per-user message status (pending/signed/dismissed)
- Indexes for performance
- Row Level Security (RLS) policies
- Triggers for updated_at timestamps

### Verification:

After running the migration, verify the tables exist by running:

```sql
SELECT COUNT(*) FROM messages;
SELECT COUNT(*) FROM message_recipients;
```

Both queries should return 0 (empty tables) without errors.

### Troubleshooting:

If you see "relation already exists" errors, the migration was already run. You can safely ignore these.

If you see permission errors, ensure you're using a database role with CREATE TABLE permissions.

