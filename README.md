# Atacado Exponencial — Gestão de Mentorados

Plataforma de acompanhamento da jornada dos mentorados. Centraliza contexto,
agenda, participação real, sinalizações de risco e conquistas em uma interface
única para o time de mentores.

## Rodando localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

Para validar a versão de produção:

```bash
npm run build
npm start
```

## O que já está disponível

- dashboard operacional com indicadores, agenda e alertas;
- cadastro, busca, filtro e ficha detalhada de mentorados;
- edição manual de risco, motivo e próxima ação;
- agenda com encontros individuais e em grupo;
- registro manual de participação e notas;
- mural e registro de conquistas;
- layout responsivo para desktop e celular.

## Estado dos dados

O app usa Supabase Auth e PostgreSQL com RLS. Mentorados, riscos, conquistas,
encontros e participações são persistidos no banco. As alterações de schema
ficam versionadas em `supabase/migrations`.

## Google Calendar

A sincronização usa service account com delegação em todo o domínio. No Google
Admin Console, autorize o Client ID numérico da service account para o escopo:

```text
https://www.googleapis.com/auth/calendar.events.readonly
```

Depois de entrar na plataforma, use **Google Calendar → Sincronizar agora** no
menu lateral. A sincronização cria ou atualiza encontros, mas nunca registra
presença automaticamente.
