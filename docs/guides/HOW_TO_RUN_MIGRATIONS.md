# 🚀 How To Run Database Migrations

## TL;DR - Quick Start

```bash
# For RAMS feature
npx tsx scripts/run-rams-migration.ts
npx tsx scripts/setup-rams-storage.ts

# For existing migrations
npx tsx scripts/run-db-migration.ts
```

That's it! **100% automated** - no manual steps needed anywhere!

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

