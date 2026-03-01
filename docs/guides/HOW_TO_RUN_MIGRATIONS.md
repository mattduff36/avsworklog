# 🚀 How To Run Database Migrations

## TL;DR - Quick Start

```bash
# Run your migration script
npx tsx scripts/run-<feature>-migration.ts

# ⚠️ ALWAYS run this immediately after — catches broken triggers/columns before deploy
npm run db:validate
```

Both steps are required. The validate step **exits non-zero** if anything is broken, so it will block a push if you add it to a pre-push hook.

---

## 🚨 Why db:validate Is Mandatory

PostgreSQL trigger functions store column names as plain text. When you rename a column (`vehicle_id → van_id`), **the trigger is not updated automatically** and PostgreSQL won't warn you — the error only appears when a user fires the trigger in production.

`npm run db:validate` catches this by:
- Scanning every trigger function body for `NEW.col` / `OLD.col` references and checking those columns exist on the trigger's table
- Checking that all required columns exist on core tables (`van_inspections`, `vehicle_maintenance`, etc.)
- Verifying critical FK relationships (`plant.category_id → van_categories`, etc.)

**Rule:** If your migration renames a column, renames a table, or drops a column — run `npm run db:validate` before committing.

---

## ✅ What You Need

Your `.env.local` file must have:

```bash
POSTGRES_URL_NON_POOLING="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

**Where to get this:**
1. Supabase Dashboard → Settings → Database
2. Connection string → URI → Session mode
3. Copy and paste into `.env.local`

---

## 🔄 How It Works

1. **Script reads** `.env.local` for database connection
2. **Connects directly** to PostgreSQL via `pg` library  
3. **Executes SQL** from `supabase/*.sql` file
4. **Verifies** tables were created
5. **Reports** success or error

---

## 🎯 Why This Is Better

### ❌ Old Way (Manual)
1. Copy SQL from file
2. Open Supabase Dashboard
3. Navigate to SQL Editor
4. Paste SQL
5. Click Run
6. Hope it worked
7. No verification
8. Repeat for each environment

### ✅ New Way (Automated)
1. Run: `npx tsx scripts/run-rams-migration.ts`
2. Done.

---

## 🐛 Common Issues

### "Missing database connection string"

**Fix:** Add `POSTGRES_URL_NON_POOLING` to `.env.local`

### "already exists"  

**Fix:** This is fine! Migration was already run. Script exits successfully.

### "permission denied"

**Fix:** Your database user needs permissions. Use service role key connection string.

---

## 📚 More Details

See `docs/MIGRATIONS_GUIDE.md` for:
- Creating new migrations
- Best practices
- Advanced patterns
- Troubleshooting

---

**Remember:** Run migrations using `.env.local` variables, not manually in dashboard!

