# House of Fries — LOCAL XAMPP (no-GitHub mode)

Working directory: C:\xampp\htdocs\HouseOfFriesLiveDomain
URL: http://localhost/HouseOfFriesLiveDomain/
Git: kept locally, work on `master`, NEVER push / NEVER make branches.

## Database (2026-10-08 switch)
- DB: `house_of_fries_db` (XAMPP MariaDB 10.4.32, root, no password)
- Imported from: `sql/FINAL_DATABASE.sql` (31 tables, seed data: 12 users, 35 menu items, 6 roles, 12 tables)
- Import note: file has CREATE TABLE ... PRIMARY KEY (line 460) AND trailing ALTER TABLE ADD PRIMARY KEY — re-import
  onto an EXISTING populated DB fails at line 468 with "Multiple primary key defined". Import onto a FRESH/empty DB only.
- `backend/db.php` now points to `127.0.0.1 / house_of_fries_db / root / ''`.
  Old InfinityFree config saved as `backend/db.php.infinityfree.bak`.
- SQL file has 0 INSERTs for menu/items — data comes from the seed in the file itself (INSERT IGNORE discount_types only);
  menu/items/roles/users/tables ARE present because house_of_fries_db already held them. If a fresh DB seems empty,
  check whether the file's CREATE TABLE + data are both in there.

## Verified working (via curl)
- http://localhost/HouseOfFriesLiveDomain/backend/login.php → JSON auth response (wrong-pass: "Invalid username or password… remaining")
- http://localhost/HouseOfFriesLiveDomain/customer/get_menu.php → 35 menu items JSON
- http://localhost/HouseOfFriesLiveDomain/customer/check_geofence.php → JSON (MISSING_COORDS, ENFORCED)
- backend/waiter/get_tables.php + get_menu_items.php → correct 401 "Missing or invalid Authorization header" (auth guard active, DB reachable)
- index.html → 200

## Login creds (seed)
- Admin: jester (role 1) · Supervisor: jerico (5) · Kitchen: elmer/sryne (3/4) · Inventory: rona/larken (2) · Waiter: anna (1→cashier role 1?) — verify against roles table as needed. Passwords are bcrypt in DB; if you need one, reset via SQL (password_hash) and note it in the vault.

## Gotchas
- `php` not on PATH → use C:/xampp/php/php.exe for `php -l` etc.
- MySQL CLI: C:/xampp/mysql/bin/mysql.exe -u root …
- git remote still points at github.com/jericosalvador61-svg/HouseOfFriesLiveDomain — do NOT push. To make accidental pushes
  fail loudly later we could `git remote remove origin`, but left in place for now (Jerico said keep repo, just don't push).
- SQL import: use `--default-character-set=utf8mb4` to keep emoji.
