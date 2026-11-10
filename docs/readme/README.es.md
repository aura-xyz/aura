[简体中文](../../README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md) | **Español** | [Português](./README.pt.md)

<p align="center">
  <img src="../../logo.png" width="128" alt="Aura" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/version-v0.8.0--rc.2-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange.svg" alt="Tauri" />
</p>

Aura es un **agente de IA de escritorio con enfoque local**. Reúne chat, lectura/escritura de archivos, ejecución de comandos, skills y servidores MCP en una aplicación ligera. Las conversaciones, claves y ajustes permanecen en tu equipo.

> Minimal surface. Maximum logic.

## Por qué Aura

- **Local primero**: sesiones, claves y ajustes en SQLite local. Las claves se cifran con el llavero del sistema / DPAPI (Linux usa cifrado interno si no hay llavero, y lo indica). Sin servidor intermediario.
- **Hace el trabajo**: herramientas integradas para leer, escribir, buscar y ejecutar comandos. Los tres modos imponen permisos en código, no solo en el prompt.
- **Extensible con control**: las skills se cargan bajo demanda; los servidores MCP añaden herramientas externas, pero toda llamada pasa por aprobación y reglas de seguridad.
- **Detalles de escritorio**: bandeja, notificaciones, memoria de ventana, arrastrar y soltar, paleta de comandos, actualización automática multi-fuente.

## Novedades de v0.8.0

- **Nueva interfaz**: colores semánticos con control de contraste, sesiones agrupadas por tiempo, panel de archivos en árbol con vistas previas, pestañas del panel derecho, paleta `Ctrl+K`.
- **Entrada y mensajes**: pegar/arrastrar imágenes como adjuntos, nivel de contexto, regenerar con historial de versiones, barra de código y diferencias.
- **Seguridad**: reglas de comandos con fuente única, flujo de aprobación, panel de eventos, claves enmascaradas con borrado independiente.
- **MCP (parte 1)**: CRUD de servidores stdio y estado, descubrimiento de herramientas con renombrado por conflicto, visibilidad por espacio de trabajo, activación por servidor; las herramientas MCP son Exec y requieren aprobación.
- **Correcciones en Linux**: argumento de autoinicio, esquinas de la ventana, lista «abrir con» e iconos, y respaldo del llavero para cambiar de modelo.
- **Espejos**: actualizaciones y mercado oficial compiten entre 7 espejos integrados; las fuentes personalizadas pueden usar su propio espejo.

## Funciones

### Chat

Salida en streaming con parada y respaldo automático de modelo; compresión de contexto cerca del límite. Regenerar y editar-y-reenviar con versiones. Navegación por turnos, búsqueda global, copiar, plegado y diferencias. Las horas en la lista de sesiones se pueden desactivar en Apariencia.

### Modelos

17 proveedores en la nube, Azure OpenAI y endpoints compatibles; Ollama y llama.cpp locales; catálogo con favoritos; cadena de respaldo.

### Herramientas y espacio de trabajo

Herramientas de lectura (`list_files`, `read_file`, `search_workspace`), escritura (`write_file`, `string_replace`, `replace_lines`) y `run_script`. Varios espacios y sesiones, lista de rutas permitidas, línea de tiempo, lista de tareas.

### Skills y MCP

Skills `SKILL.md` bajo demanda que solo pueden reducir permisos. Mercado con inspección previa; fuentes GitHub o SkillHub. MCP parte 1: servidores stdio, estado, descubrimiento y reescaneo `list_changed`, renombrado por conflicto, alcance por espacio de trabajo, activación por servidor. Las llamadas MCP requieren aprobación y registran `mcp_call`.

### Seguridad y privacidad

Claves enmascaradas, borrado independiente y cifrado en reposo. Una sola fuente de reglas para inspección y bloqueo en ejecución. Visor de eventos con exportación.

### Escritorio

Bandeja (cerrar = minimizar), notificaciones solo sin foco, estado de ventana, barras finas, menús contextuales, arrastrar archivos, pegar imágenes, actualización multi-espejo.

## Modos

| Modo | Uso | Leer | Escribir | Ejecutar |
| --- | --- | :---: | :---: | :---: |
| Chat | Solo preguntas | ✓ | — | — |
| Plan | Producir un plan | ✓ | — | — |
| Build | Ejecutar el trabajo | ✓ | ✓ | ✓ |

Los permisos se aplican en código; las llamadas bloqueadas explican cómo cambiar de modo. Las herramientas costosas como MCP solo se inyectan en Build.

## Proveedores integrados

Internacionales: OpenRouter, OpenAI, DeepSeek, Groq, xAI Grok, Together AI, Azure OpenAI.
China: Zhipu GLM, Moonshot Kimi, MiniMax, SiliconFlow, Yi, Baichuan, StepFun, Alibaba Bailian (Qwen), Volcengine Ark (Doubao), Tencent Hunyuan.
Local: Ollama, llama.cpp server. También endpoints compatibles personalizados.

## Instalación

Descarga desde [Releases](https://github.com/aura-xyz/aura/releases):

- **Windows x64**: `Aura_<version>_win_x64_Setup.exe`
- **Linux x64 Debian/Ubuntu**: `aura_<version>_amd64.deb`
- **Linux x64 universal**: `aura_<version>_amd64.AppImage` (la actualización interna solo funciona con AppImage)
- **Dependencias Linux**: WebKitGTK 4.1 y libsecret

## Compilar desde el código

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## Configuración

Ajustes → Modelos: proveedor, clave, catálogo y favoritos. Ajustes → General: rutas permitidas, reglas globales, espejo de skills. Ajustes → Apariencia: tema, tamaño, Markdown en vivo, horas de sesión. Ajustes → Seguridad: eventos.

## Contribuir

Issues y pull requests son bienvenidos. Lee primero [CONTRIBUTING](../../CONTRIBUTING.md) y [CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md).

## Licencia

[Apache License 2.0](../../LICENSE).
