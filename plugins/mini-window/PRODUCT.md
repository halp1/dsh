# DSH Mini Window
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
DSH users on macOS who need quick access to their agents while working in another application.

## Product Purpose
An always-on-top compact chat and expanded conversation, with real DSH session history, configurable global toggle shortcut, and local Command+N new chat.

## Stack
Confirmed: DSH plugin plus Electron companion; reuse the installed DSH frontend and public Cordis services and slots.

## Operating Context
The DSH web profile stays running. A hidden accessory companion registers the global shortcut. Opening resumes the last mini session. Expanded mode is natively resizable and remembers its size; compact mode is not resizable.

## Capabilities and Constraints
Do not modify DSH core or the normal GUI. Host chat/model state is shared; unsent drafts are client-local. Electron setup needs a binary download when missing. Initial support targets the web profile on macOS, not a standalone signed app or login item.

## Brand Commitments
User-provided Gemini mini-window screenshots: dark rounded compact prompt bar and expanded conversation. Use DSH branding and DSH's real composer and actions.
