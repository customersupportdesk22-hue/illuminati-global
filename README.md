# Illuminati Global — v2.0

An independent, Illuminati-themed worldwide membership community. This project is not affiliated with any historical organization or secret society.

## Features
- Responsive black-and-gold public website with a supplied-artwork slideshow.
- Free registration, secure password hashing and cookie-based sessions.
- Country selector, calling-code suggestions, currency display and optional browser location assistance.
- Separate Terms of Service and Privacy Policy pages.
- Member dashboard with profile, internal account balance and transaction history.
- Administrator-only member directory and balance credit/debit controls with an audit trail.
- Members cannot transfer balances to one another or edit their own balances.

## Requirements
- Node.js 18+
- MongoDB Atlas or another MongoDB deployment

## Environment variables
Copy `.env.example` values into Render → Environment. Never commit `.env`.

- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: unique random secret of at least 32 characters
- `NODE_ENV`: `production`
- `PORT`: supplied by Render automatically

## Run locally
```bash
npm install
npm start
```

## Create the one administrator account
```bash
npm run create-admin
```
The script refuses to create a second administrator. Keep the admin credentials private. If an admin already exists, use that account.

## Render
- Build command: `npm install`
- Start command: `npm start`
- Add `MONGODB_URI`, `JWT_SECRET`, and `NODE_ENV=production` under Environment.

## Important balance limitation
The balance is an internal platform ledger. Credits and debits are manually recorded by the administrator and shown in the member's selected country currency. The currency label is a display denomination, not a live foreign-exchange conversion. This project does not process bank transfers, mobile-money payouts, deposits, withdrawals or customer-to-customer transfers. Do not describe internal balances as cash or guaranteed payouts.

## Before public launch
Review the legal templates for the operator's actual identity, contact details, applicable privacy and consumer laws, retention requirements, and the countries in which the service will operate. Add email verification, password recovery, monitoring, backups and an independently reviewed security process before handling sensitive or financial data.
