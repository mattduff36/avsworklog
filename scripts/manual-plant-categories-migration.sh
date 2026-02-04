#!/usr/bin/env bash
# Manual Migration Runner for Plant Maintenance Categories
# Run this if the automated migration fails

echo "🔧 Plant Maintenance Categories Migration"
echo "=========================================="
echo ""
echo "The automated migration failed due to connection issues."
echo "Please run this migration manually:"
echo ""
echo "1. Open Supabase Dashboard:"
echo "   https://supabase.com/dashboard/project/lrhufzqfzeutgvudcowy/sql"
echo ""
echo "2. Click 'SQL Editor' → 'New query'"
echo ""
echo "3. Copy the contents of this file:"
echo "   supabase/migrations/20260203_add_plant_maintenance_categories.sql"
echo ""
echo "4. Paste into the SQL editor and click 'Run'"
echo ""
echo "5. You should see output like:"
echo "   ✅ Plant maintenance categories migration completed!"
echo "   Hours-based categories: 1"
echo "   Plant-applicable categories: 2"
echo ""
echo "=========================================="
echo ""
echo "Press Enter to open the SQL file in your default editor..."
read
cat supabase/migrations/20260203_add_plant_maintenance_categories.sql
