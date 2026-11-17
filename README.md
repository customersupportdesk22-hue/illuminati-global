# Illuminati Global — Member Portal

Worldwide membership platform with a responsive public website and member application.

## Features
- Responsive crimson, burgundy and dark public website with supplied artwork slideshow.
- Free member registration, secure password hashing and cookie-based sessions.
- Worldwide country selection, calling codes, country currency display and optional browser location assistance.
- Dedicated Terms of Service and Privacy Policy pages.
- Mobile-first member dashboard with Home, Wallet, Account and Settings navigation.
- Internal wallet ledger, activity history, member service requests and in-app notifications.
- Member-to-administrator support messaging with an administrator inbox.
- Administrator-only balance credits/debits and request review with an audit trail.
- Members cannot transfer balances to one another or edit their own balances.

## Requirements
- Node.js 18+
- MongoDB Atlas or another MongoDB deployment

## Environment variables
Set these in Render → Environment. Never commit `.env`.
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: unique cryptographically random secret of at least 32 characters
- `NODE_ENV`: `production`
- `PORT`: supplied by Render automatically

## Run locally
```bash
npm install
npm start
```

## Create the administrator account
```bash
npm run create-admin
```
The script refuses to create a second administrator. Keep administrator credentials private.

## Render
- Build command: `npm install`
- Start command: `npm start`
- Keep your existing `MONGODB_URI` and `JWT_SECRET` environment variables.

## Financial and service request limitations
The wallet is an internal platform ledger. Only the administrator can credit or debit member balances. Member withdraw, send, invest and bank-transfer actions submit requests for administrator review; they do not execute a payout, bank transfer, customer-to-customer transfer, investment, or guarantee of returns. A payment provider and the required legal/compliance arrangements must be integrated and verified before real-money functionality is offered.

## Before public launch
Review the legal pages for the operator's actual identity and contact details, applicable privacy and consumer laws, and countries served. Add email verification, password recovery, backups, monitoring and an external security review before handling sensitive or financial data.
