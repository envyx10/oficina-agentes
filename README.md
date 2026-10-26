<div align="center">

# 🏢 Mi oficina de agentes de IA

**Un rascacielos pixel-art, al lado de tu chat, donde cada sesión de Claude Code es un piso.**

Mira de un vistazo quién trabaja, quién está atascado, quién te necesita y cuánto gasta cada agente.

<img src="docs/demo.gif" alt="El rascacielos animado: oficinas encendidas, ascensor llevando mensajes, paloma mensajera y contador de tokens" width="420">

[![Claude Code mod](https://img.shields.io/badge/Claude_Code-mod-d97757?style=for-the-badge)](https://claude.com/claude-code)
[![MIT](https://img.shields.io/badge/licencia-MIT-4f8cff?style=for-the-badge)](LICENSE)
![Sin dependencias](https://img.shields.io/badge/dependencias-0-3dff8a?style=for-the-badge)

[Instalar](#-instalación) · [Qué ves](#-qué-ves) · [Cómo funciona](#%EF%B8%8F-cómo-funciona) · [English](#-english)

</div>

---

## ✨ Qué ves

<table>
<tr>
<td width="50%" valign="top">

### 🔴🟡🔵 Cada piso, un agente

Todas las sesiones de Claude Code de tu ordenador, en la terminal, en la app de escritorio o en worktrees, aparecen como oficinas del edificio:

| | Estado | Qué significa |
|---|---|---|
| 🔴 | **Te necesita** | Espera tu permiso o te ha hecho una pregunta. La oficina parpadea en rojo. |
| 🔵 | **Trabajando** | Monitor escribiendo código, el agente tecleando, LEDs del rack parpadeando. |
| 🟡 | **Para revisar** | Ha terminado y espera a que lo mires. |
| 💤 | **Dormido** | Sin actividad. Luces apagadas y *zzz*. |
| 🏷️ | **En venta** | Plantas libres para nuevos agentes. |

Cada oficina muestra el nombre de la sesión, sus iniciales, el contador de tokens, lo que lleva gastado y, si delega trabajo, sus **subagentes** como mini-ayudantes junto a la mesa.

</td>
<td width="50%" valign="top">

<img src="docs/panel-completo.png" alt="El panel completo: edificio y directorio" width="100%">

</td>
</tr>
</table>

### 🗂️ El directorio del vestíbulo

Debajo del edificio, un directorio con marco de latón: una tarjeta por agente, **primero los que te necesitan**. Cada tarjeta tiene el botón de ascensor de su planta, su estado, el proyecto, **lo que está haciendo ahora mismo** ("Editando Hero.tsx", "Ejecutando: prisma migrate"…), lo que gasta y su parte del total de tokens.

<div align="center">
<img src="docs/directorio.png" alt="Directorio del vestíbulo con una tarjeta por agente" width="420">
</div>

### 🌇 Y todo lo demás

- **🛗 Ascensor:** recorre los pisos de los agentes activos llevando un sobre.
- **🕊️ Paloma mensajera:** cruza el cielo con el último aviso ("API DE PAGOS te necesita").
- **🏭 Centro de datos:** un contador con **todos los tokens que has generado en tu vida** con Claude Code y el ritmo actual en tokens por minuto.
- **🌤️ El tiempo real de donde estás**: detecta tu ubicación sola y consulta [Open-Meteo](https://open-meteo.com), sin claves.
- **☀️🌆🌙 El cielo sigue la hora de tu ciudad:** de día, al atardecer o de noche con estrellas y ventanas encendidas.

<div align="center">
<img src="docs/dia-tarde-noche.png" alt="El mismo edificio de día, al atardecer y de noche" width="100%">
</div>

---

## 📦 Instalación

Necesitas **Claude Code** y **Node.js** (el escáner de sesiones es un pequeño script de Node).

En una sesión de Claude Code en la terminal, escribe:

```
/plugin install oficina-agentes --marketplace envyx10/oficina-agentes
```

Contesta `y` para añadir el marketplace y elige el alcance **user**, para que salga en todas tus sesiones.

Desde una shell:

```bash
claude plugin install oficina-agentes --marketplace envyx10/oficina-agentes
```

**En la app de escritorio**, donde `/plugin` no está disponible: pulsa **+** junto a la caja del mensaje, luego **Plugins**, **Add marketplace** con `envyx10/oficina-agentes`, y después **Add plugin**.

### Uso

El panel se abre solo al empezar cada sesión. Si lo cierras, vuelve con:

```
/control
```

(también vale `/oficina`).

### ⚙️ Configuración

| Opción | Por defecto | Qué hace |
|---|---|---|
| `city` | *(vacío)* | Vacío: usa tu ubicación real (ver abajo). Si pones una ciudad, se usa esa: `Madrid`, `Ciudad de México`, `Buenos Aires`… |

**¿De dónde saca tu ubicación?** En Windows, de la **ubicación del sistema** (Wi-Fi/GPS, la misma que usa el mapa), que es donde estás de verdad. Si no está disponible (o en macOS y Linux), la deduce de tu IP, que es menos precisa: según el operador puede situarte en otra ciudad. El nombre del lugar sale de [OpenStreetMap](https://www.openstreetmap.org). Se consulta cada 30 min y se comparte entre todas tus sesiones.

Para fijar una ciudad, cámbiala desde el menú de configuración de Claude Code (`/config`), o en `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "oficina-agentes": { "options": { "city": "Madrid" } }
  }
}
```

---

## ⚙️ Cómo funciona

```
~/.claude/projects/**/*.jsonl ──► scanner/scan.cjs ──► una línea JSON cada 2 s ──┐
   (transcripciones de todas                (Node, lee solo                        │
    las sesiones y subagentes)               lo nuevo de cada archivo)             ▼
                                                                   hooks/register.tsx ──► panel
~/.claude/oficina-agentes/<sesión>.json ◄── cada sesión con el mod                (SVG animado)
   (estado exacto: ¿espera permiso?)         escribe su propio estado
~/.claude/oficina-agentes/place.json    ◄── el escáner localiza el PC (Windows o IP)
```

- **Todas las sesiones de tu PC:** el escáner lee las transcripciones que Claude Code guarda en `~/.claude/projects`. De ahí saca el título, lo que está haciendo, los tokens y los subagentes. Lee cada archivo de forma incremental y guarda su progreso en caché, así que es ligero aunque tengas cientos de MB de historial.
- **Estado exacto:** cada sesión que tiene el mod cargado escribe su propio estado (por ejemplo, "esperando tu permiso"), y ese manda sobre lo que se deduce de la transcripción.
- **Sin parpadeos:** el edificio y el directorio son una sola imagen que solo se regenera cuando un piso cambia de color o llega o se va un agente (y cada 5 min para los números). Al hacer scroll o clic se reutiliza exactamente la misma imagen, y se pinta como imagen normal, no como marco interactivo, así que al cambiar no hay flash. Las animaciones van sincronizadas con el reloj: tras un cambio siguen donde estaban. Los contadores en vivo van en texto nativo del panel.
- **Coste:** exacto para las sesiones con el mod. Para el resto se estima a partir de los tokens con precios aproximados por modelo.

### Estructura

```
.claude-plugin/
  plugin.json        manifiesto y opción "city"
  marketplace.json   para instalarlo con /plugin install
hooks/
  register.tsx       hooks del mod: estado de la sesión, panel, comandos
  tower.ts           el rascacielos (SVG)
  directory.ts       el directorio del vestíbulo (SVG)
scanner/
  scan.cjs           vigila ~/.claude/projects y localiza el PC
types/index.d.ts     contrato de estado del mod
tests/
  pane.test.tsx      el panel en escritorio y terminal; un scroll no regenera el dibujo (claude plugin test)
```

### 🔒 Privacidad

Tus sesiones y transcripciones no salen de tu máquina. Lo único que sale a internet es lo necesario para el tiempo: tus coordenadas aproximadas a OpenStreetMap (para el nombre del lugar) y a Open-Meteo (para el tiempo), y, solo si no hay ubicación del sistema, una consulta de tu IP a ipwho.is. Si pones `city`, no se usa tu ubicación.

---

## 🌍 English

**My AI agents office:** a pixel-art skyscraper beside your Claude Code chat where **every Claude Code session on your machine is a floor**.

- 🔴 **Needs you:** waiting for your permission or asking a question (blinking red).
- 🔵 **Working:** live activity ("Editing Hero.tsx", "Running: prisma migrate").
- 🟡 **To review:** finished, waiting for you to look.
- 💤 **Sleeping:** idle.

Each office shows the session title, tokens, cost, and its subagents. Below the tower, a lobby **directory** lists every agent, the ones that need you first. Plus an elevator carrying messages, a carrier pigeon with the latest alert, a data center counting **every token you've ever generated**, and real weather where you are, with a sky that follows the local time of day.

**Install** (needs Claude Code and Node.js):

```
/plugin install oficina-agentes --marketplace envyx10/oficina-agentes
```

Open the panel with `/control` (or `/oficina`). Your location is detected automatically: Windows location services first (where you really are), else your IP. Or pin a city with the `city` option. The interface is in Spanish.

It reads the transcripts Claude Code keeps in `~/.claude/projects`, incrementally and locally. The only network calls are for the weather: your approximate coordinates to OpenStreetMap and Open-Meteo, and an IP lookup only when there is no system location.

---

<div align="center">

Inspirado en la oficina de agentes de [@kodofactory](https://www.tiktok.com/@kodofactory) · Hecho por [@envyx10](https://github.com/envyx10) · [MIT](LICENSE)

</div>
