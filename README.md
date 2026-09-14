# DSR Field

App de **Daily Service Reports** para trabajo de campo (Mission Critical Group). Sirve para abrir un trabajo, pichar horas, subir fotos y sacar el PDF oficial — en el teléfono en sitio o en la laptop en el trailer.

## Qué puedes hacer

- Guardar el job una vez (cliente, WO, voltajes, técnico, crew).
- Abrir **Today** y pichar Arrive / trabajo / Standby. El siguiente punch cierra el anterior.
- Marcar issues CXAlloy y evidencia de cierre.
- Importar un año de DSRs (PDF o ZIP).
- Exportar el PDF oficial de un día, o un ZIP de la semana / mes.

En el teléfono: barra inferior, textos largos recortados o con scroll horizontal, y lo que no hace falta (nombre de cuenta, selector de job, hints) se oculta para que nada se salga de la pantalla. En laptop: barra lateral y el informe del día en dos columnas.

## Requisitos

Ver `requirements.txt`. En corto:

- Node.js 22 o superior
- npm 10 o superior

Las dependencias de JavaScript se instalan con npm (no pip). El lockfile canónico es `package-lock.json`.

## Cómo arrancarla

```bash
npm install
npm run dev
```

La app queda en `http://localhost:8080`.

Otros comandos:

```bash
npm run typecheck
npm run build
npm run preview
```

## Uso rápido

1. Entra con Google, X o email.
2. Importa PDFs o crea un job en **New job**.
3. **Today** → crew, punches, fotos, close-out.
4. **Export official PDF** (o **Export** para un rango).

Los reportes se guardan en tu cuenta. El PDF usa el formulario oficial (logo, campos, fotos con caption / tag CXAlloy).

## Stack

React 19, TanStack Start, Tailwind CSS v4, Postgres (Neon / PGlite en local), Better Auth, pdf-lib.

## Móvil

- Nada debe generar scroll horizontal de la página: chips y filtros se deslizan en su propia fila.
- Títulos, nombres de job y líneas de punch se recortan (`…`) o se limitan a 2–3 líneas.
- Botones con etiquetas largas muestran una versión corta en pantallas chicas.
- Cuenta y cambio de job viven en **Me** / **Jobs** en el teléfono, no amontonados en el header.
