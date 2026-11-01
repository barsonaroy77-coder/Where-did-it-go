# Where Did It Go?

Now you know.

## Status

This app is under active development and is currently in Phase 1 of 11 (setup and design system complete). Only the initial project setup, theme tokens, and foundation UI components are currently implemented in code.

## About

Where Did It Go? is an offline-first mobile app for tracking income and expenses, understanding monthly cash flow (saved versus spent), and managing category budgets and savings goals. All user financial screens read directly from a local SQLite database to guarantee reliable offline functionality without requiring an active network connection. Once connected, local transactions and updates saved in the mutation outbox automatically synchronize with Supabase.

## Planned Features

- [ ] Quick income and expense entry with undo support
- [ ] Monthly Saved vs. Spent summaries and deficit warnings
- [ ] Monthly savings goals with progress tracking
- [ ] Repeating category budgets with 80% and 100% threshold alerts
- [ ] Offline natural-language transaction entry
- [ ] Category breakdown, comparison bars, and spending trend charts
- [ ] Server-generated recurring transactions
- [ ] Transaction search, filtering, and CSV export
- [ ] Multi-device synchronization with visible conflict resolution

## Tech Stack

Installed versions from package.json:
- Expo: ~58.0.22
- React Native: 0.88.1
- React: 19.3.0
- TypeScript: ~6.0.3
- Expo Router: ~58.0.29
- expo-font: ~58.0.11
- @expo-google-fonts/space-grotesk: ^0.4.1

Technologies planned in the PRD:
- Supabase (Postgres, Auth, Row-Level Security)
- expo-sqlite (local offline-first database)
- expo-secure-store (session credential storage)
- expo-crypto (client-generated UUIDs)

## Design

The app uses a neobrutalist wallet-app aesthetic characterized by a cream background, bold black borders, hard offset shadows without blur, high-contrast accents, and Space Grotesk typography.

## Getting Started

On Windows, use Command Prompt (cmd.exe) instead of PowerShell if PowerShell script execution policies block scripts.

Install dependencies:
```cmd
npm install
```

Start the Expo development server:
```cmd
npx expo start
```

## Project Structure

- assets - App icons, splash images, and static assets
- docs - Project PRD v4.0, agent instructions, and setup documentation
- src/app - Expo Router file-based screens and navigation layouts
- src/components - Reusable neobrutalist UI components (Button, Card, Chip, Input, Toast)
- src/db - Local SQLite database schemas, migrations, and repositories
- src/lib - Shared utilities, calculation helpers, and validation functions
- src/sync - Offline mutation outbox and synchronization handlers
- src/theme - Theme tokens (colors, typography, spacing, borders, radii, shadows)

## Roadmap

- [x] Phase 1: Setup and Design
- [ ] Phase 2: Database Layer — Supabase
- [ ] Phase 3: Backend and Auth
- [ ] Phase 4: Local Storage and Offline Infrastructure
- [ ] Phase 5: Frontend Integration
- [ ] Phase 6: Sync Engine Integration
- [ ] Phase 7: Testing
- [ ] Phase 8: Debugging and Optimization
- [ ] Phase 9: Polish
- [ ] Phase 10: Launch
- [ ] Phase 11: After Launch

## Screenshots

Coming soon
