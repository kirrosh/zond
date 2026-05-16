---
id: m-7
title: "ux-polish"
---

## Description

Полировка WebUI (`zond serve`) после закрытия trust-loop (m-6). Цель — сделать так, чтобы:

1. **Новичок-в-домене** проходил первую встречу без чтения README: видел onboarding на пустом workspace, понимал термины (cascade / partial-failed / provenance) через встроенный glossary, находил шаги поиском.
2. **Активный пользователь** видел реальный прогресс live-run'а, мог сравнить два прогона, имел overview зарегистрированных API и fixtures gaps.
3. **Power-user** работал с клавиатуры (`j/k/?/cmd-k`), не терял replay-черновики между перезагрузками.
4. **UI-регрессии ловились автоматически** — Playwright e2e на golden paths + axe accessibility + visual snapshots.

Параллельно — чистка спайков (fake live-progress strip) и избыточностей в Runs-таблицах.

Майлстоун не покрывает: новые probe-классы, изменения в CLI-домене, dogfooding в реальных проектах.
