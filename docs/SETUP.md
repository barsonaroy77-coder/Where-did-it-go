# Setup Guide

## Core Dependency Versions

The exact package versions defined in `package.json`:

- **Expo**: `~58.0.22`
- **React Native**: `0.88.1`
- **React**: `19.3.0`
- **TypeScript**: `~6.0.3`
- **expo-router**: `~58.0.29`
- **expo-font**: `~58.0.11`
- **@expo-google-fonts/space-grotesk**: `^0.4.1`

## Windows Setup & Execution

> **Note**: On Windows, use **Command Prompt (`cmd.exe`)** instead of PowerShell because PowerShell execution policies may block executable scripts (such as `npx.ps1`).

### Commands

1. **Install dependencies:**
   ```cmd
   npm install
   ```

2. **Typecheck:**
   ```cmd
   npx tsc --noEmit
   ```

3. **Start the project:**
   ```cmd
   npx expo start
   ```

## Folder Structure

- **`src/app`** (or **`app`**): Expo Router routes and screen definitions (`_layout.tsx`, `index.tsx`).
- **`src/components`**: Reusable design system UI components (`Button`, `Card`, `Chip`, `Input`, `Toast`).
- **`src/theme`**: Central theme tokens (colors, typography, spacing, borders, radii, shadows).
- **`src/db`**: Local SQLite database schemas, migrations, and queries.
- **`src/sync`**: Offline-first synchronization engine and transaction outbox handlers.
- **`src/lib`**: Common utility functions, helpers, and validators.
- **`docs`**: Specifications, architecture docs, agent guidelines, and setup documentation.
