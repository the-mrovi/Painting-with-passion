# Painting with passion

A static, multi-page portfolio and art shop backed by Supabase Auth, Postgres, and private Storage buckets.

## Supabase status

The schema in [`supabase/schema.sql`](supabase/schema.sql) has been applied to project `xleffmncnrkpcsbycbsv`. It includes RLS, storage policies, content tables, likes/comments, cart/orders, activity events, admin authorization, and category management.

The approved administrator emails are stored in the private database allowlist through [`supabase/admin-setup.example.sql`](supabase/admin-setup.example.sql). The targeted [`supabase/admin-access-and-customer-guard.sql`](supabase/admin-access-and-customer-guard.sql) patch has also been applied to the connected project. Matching users use the normal email/password login; the database trigger assigns and removes admin access from the private allowlist, including when an approved admin registers later.

The SQL files use placeholder administrator addresses so personal emails are not published. Replace those placeholders with the intended addresses before running the setup or backfill scripts in another Supabase project.

Admin accounts are blocked from cart policies and from the `place_order` database function. These controls are enforced by Postgres/RLS in addition to the frontend navigation.

The app uses only Supabase Free-plan primitives: email/password Auth, Postgres, RLS, REST/RPC, and private Storage. It does not depend on a paid Supabase add-on or paid external API.

For an existing installation, run [`supabase/public-artwork-access-and-availability.sql`](supabase/public-artwork-access-and-availability.sql) once in the Supabase SQL editor. It adds the restricted public artwork-preview RPC and storage policy, reinforces authenticated Thought interactions, and keeps the final availability check inside the order transaction. It does not expose full artwork stories or private Highlight media.

## Required Auth settings

- Set the production website URL under **Authentication → URL Configuration**.
- Add the production `index.html` and `reset-password.html` URLs to the redirect allowlist for email confirmation and password recovery. For example: `https://your-domain.example/reset-password.html`.
- Enable leaked-password protection under **Authentication → Attack Protection** when the project plan supports it.

The frontend uses the publishable key only. Never add a secret or service-role key to these files.

If an older Auth account can sign in but sees no protected content or admin controls, run [`supabase/backfill-existing-auth-profiles.sql`](supabase/backfill-existing-auth-profiles.sql) in the Painting project's SQL editor. It creates missing profile rows, synchronizes the private admin allowlist, and finishes with a verification query.

## Local preview

Serve the directory through any static web server. Authentication redirects should be tested over `http://localhost` rather than `file://` before deployment.
