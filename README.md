# Illuminati Global — Independent Membership Community

A starter website for an independent, Illuminati-themed community. It does not claim affiliation with any historical organization or secret society.

## Included
- Responsive black-and-gold landing page
- Free member registration
- Password hashing with bcrypt
- Member login and cookie-based sessions
- Member profile dashboard
- Admin member list
- Admin account creation script
- MongoDB persistence
- Basic security headers and login/registration rate limiting

## Requirements
- Node.js 18 or newer
- MongoDB database (local or Atlas)

## Setup
1. Extract the ZIP.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `MONGODB_URI` to your MongoDB connection string.
5. Set `JWT_SECRET` to a unique random value of at least 32 characters.
6. Run `npm start`.

Open `http://localhost:3000`.

## Create the first administrator
After configuring `.env`, run:

```bash
npm run create-admin
```

Enter the administrator details in the terminal. This script creates or promotes the specified account to admin. Do not expose this script through a public website.

Then log in through `/login.html`; admins are redirected to `/admin.html`.

## Deployment
Set the environment variables in your hosting provider:
- `MONGODB_URI`
- `JWT_SECRET`
- `NODE_ENV=production`
- `PORT` (if required by your host)

Deploy with `npm install` and `npm start`. Use HTTPS in production.

## Before public launch
This is a starter implementation, not a fully audited production service. Add email verification, password reset, CSRF protection appropriate to your deployment, privacy/terms pages reviewed for your jurisdiction, monitoring, backups, and security testing. Do not collect sensitive personal information you do not need.
