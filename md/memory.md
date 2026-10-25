# Attendly Mobile — Project Memory

## Source of Truth
This document records the durable decisions and context that should remain available when work resumes.

## Existing Attendly
The existing Attendly application is a production-ready PWA with React/Vite frontend, FastAPI backend, PostgreSQL/Neon database, JWT authentication, and an existing Dad/demo account model.

It is a separate system and must remain untouched during mobile development.

## New Product
Attendly Mobile is a new React Native CLI application intended for iPhone first and eventually for other mobile platforms as appropriate.

It is intended for multiple contractors.

## New Infrastructure
- React Native CLI frontend.
- New FastAPI backend.
- New PostgreSQL database.
- Local SQLite database on the device.
- Background synchronization.

## Account Model
A contractor is represented by an account/tenant.

Initial account creation:
`phone number + 4-digit MPIN + confirm MPIN`

Normal returning login on a recognized device:
`4-digit MPIN only`

All contractor data is account-scoped.

## Core Data
- Workers
- Sites
- Attendance
- Advances
- Payroll/month summaries
- Sync state

## Attendance
Work units:
- 0
- 0.5
- 1
- 1.5
- 2

Daily earnings:
`work_units × daily wage`

## Payroll
Calendar month runs from the first through the last day.

`gross = sum(attendance earnings)`

`net payable = gross - advances`

## Product Experience
The app should feel:
- fast;
- simple;
- native;
- clean;
- practical;
- modern.

Visual foundation:
black + white + greys, with one restrained accent color.

## Offline Behavior
Read local data immediately.
Write locally immediately.
Queue synchronization.
Retry failures.
Do not silently lose data.
Do not overwrite newer data with stale data.

## Development Principle
Implement one phase at a time and validate it before moving forward.

## Critical Boundary
Never use the existing production Attendly database as the mobile app's database.
