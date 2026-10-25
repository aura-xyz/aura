[简体中文](./README.md) | [English](./README-en.md) | [日本語](./README-ja.md) | **Español** | [Português](./README-pt.md)

<p align="center">
  <img src="./logo.png" width="128" alt="Aura" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/version-v0.6.3-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange.svg" alt="Tauri" />
</p>

Agente de IA de escritorio con prioridad local, construido con Tauri 2.0 + React 19 + TypeScript. Compatible con numerosos proveedores de modelos en la nube y frameworks de inferencia local; las sesiones, las credenciales y la configuración se guardan íntegramente en tu máquina.

## Funciones

- **Múltiples proveedores**: 17 preajustes de proveedores integrados (OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Zhipu GLM, MiniMax, SiliconFlow, 01.AI, Baichuan, StepFun, Groq, xAI, Together, Alibaba Bailian, Volcano Ark, Tencent Hunyuan, además de endpoints personalizados compatibles con OpenAI). Al elegir un proveedor se rellena automáticamente la dirección oficial de la API.
- **Modelos locales**: compatibilidad con Ollama y llama.cpp server: consulta el estado del servicio, descarga modelos y sigue el progreso desde la aplicación.
- **Catálogo y favoritos**: obtén con un clic la lista completa de modelos de un proveedor, búscalos y márcalos como favoritos; los favoritos se agrupan por proveedor y se pueden cambiar en cualquier momento desde la página de conversación.
- **Tres modos de trabajo**: Chat, Plan y Build, conmutables mediante las pestañas. El modo aplicado es el seleccionado en el momento de enviar cada mensaje.
- **Lista de tareas**: el modo Plan produce pasos ejecutables que se muestran en la barra lateral; el modo Build los avanza paso a paso con actualizaciones de estado en tiempo real.
- **Sesiones multiworkspace**: la barra lateral organiza las sesiones por espacio de trabajo —crear, cambiar y eliminar—; menú contextual con el botón derecho y renombrado en línea (no se tocan archivos del disco). Una vez enviado el primer mensaje, el espacio de trabajo queda bloqueado: cada conversación corresponde a exactamente un espacio de trabajo.
- **Degradación automática**: cuando el modelo principal alcanza el límite de peticiones o falla, Aura cambia al siguiente modelo disponible de la cadena de reserva e indica el motivo.
- **Salida en streaming**: renderizado incremental por SSE con efecto de máquina de escribir; la generación se puede detener en cualquier momento.
- **Conjunto completo de herramientas**: `list_files` / `read_file` / `search_workspace` para lectura y búsqueda, `write_file` / `string_replace` / `replace_lines` para editar archivos, `run_script` para ejecutar comandos —con tarjetas de acción en tiempo real, reintentos en caso de fallo y avisos de diagnóstico.
- **Gestión de contexto**: el historial se comprime automáticamente al acercarse al límite de contexto, de modo que las conversaciones largas no se interrumpen; la lista de tareas se guarda por separado y sobrevive a la compresión.
- **Lista blanca de rutas**: además del espacio de trabajo, puedes autorizar otros directorios para que el modelo lea y escriba (el directorio de habilidades, para que maintains tus propias habilidades). Los directorios del sistema y de claves se **rechazan siempre**; carpetas como `Desktop` o `Documents` te preguntan primero.
- **Cronología de operaciones**: la «Traza» de la barra lateral registra cada paso de esta conversación: qué herramientas se llamaron, con qué argumentos, cuánto tardaron y dónde se bloqueó algo. Aislada por conversación, con búsqueda y exportable a Markdown.
- **Skills (habilidades)**: instrucciones reutilizables escritas como `SKILL.md` en el espacio de trabajo o en el equipo. El modelo las carga cuando las necesita, así que las que no se cargan no consumen contexto, y una habilidad solo puede restringir permisos: nunca saltarse los límites del modo. La página Skills lista todas las habilidades con su origen (espacio de trabajo / local / mercado / integradas) y permite activarlas, desactivarlas o eliminarlas. El mercado instala con un clic, pero **antes inspecciona el paquete**: muestra los permisos que pide la habilidad y cualquier comando peligroso o línea de inyección de prompts que contenga, y tú decides. También puedes añadir cualquier repositorio de GitHub como fuente adicional, o conectar una biblioteca de habilidades de terceros como SkillHub (**filtrar por fuente y buscar dentro de ella**).
- **Página de ajustes**: barra lateral plegable; los ajustes cubren apariencia, servicios de modelos y opciones generales, con cambio de tema claro/oscuro y reglas globales.
- **Persistencia local**: el historial de sesiones, las listas de tareas y los ajustes se guardan en una base de datos SQLite local; las claves API se cifran en reposo con Windows DPAPI —nada depende de la nube.

## Modos de trabajo

Elige un modo con las pestañas. **El modo aplicado es el seleccionado en el momento de enviar cada mensaje, y se puede cambiar en cualquier momento.** Los tres modos se diferencian en el alcance de las acciones permitidas y en el enfoque del prompt:

| Modo | Finalidad | Leer archivos | Modificar archivos | Ejecutar comandos | Enfoque |
| --- | --- | :---: | :---: | :---: | --- |
| Chat | Pura pregunta-respuesta | ✓ | — | — | Responde directamente, sin flujo de trabajo |
| Plan | Producir un plan | ✓ | — | — | Primero investiga el estado actual y luego da pasos ejecutables |
| Build | Hacer el trabajo | ✓ | ✓ | ✓ | Avanza la lista de tareas paso a paso con progreso en tiempo real |

Los permisos los fuerza el propio programa: aunque el modelo intente llamar a una herramienta de escritura en modo Chat o Plan, la llamada se intercepta con un aviso para cambiar al modo Build —nunca falla en silencio.

La lista de tareas se borra automáticamente al completarse todos los pasos, se guarda con la sesión y se restaura tras reiniciar.

> **Avisos de cambios de comportamiento**
>
- v0.7.0 (en desarrollo, aún no publicado):
  - Los mensajes admiten «regenerar» y «editar y reenviar»: ambos revierten el contexto antes de reenviar, así que no queda nada obsoleto
  - Al regenerar se conserva la versión anterior, y puedes alternar entre ellas (cambiar solo afecta a la visualización; los turnos siguientes siguen basándose en la versión más reciente)
  - Clic derecho en la zona de mensajes para copiar una respuesta completa; los bloques de código tienen botón de copia
  - Las ediciones de archivo se pueden desplegar en una vista de diferencias que marca las líneas añadidas y eliminadas
  - Los bloques de código de más de 20 líneas se pliegan por defecto
  - Al soltar un archivo se adjunta su ruta a la entrada; los directorios del sistema y de claves se rechazan, y los que requieren autorización se avisan
  - La ventana puede vivir en la bandeja del sistema y seguir ejecutándose en segundo plano, con notificación del sistema al terminar una tarea (solo cuando la ventana no está delante)
  - Ctrl+F abre la búsqueda de sesiones dentro de la app
  - El estado vacío muestra tarjetas de ejemplo que rellenan un prompt inicial en la entrada
  - Cerrar la ventana ahora la minimiza a la bandeja; usa «Salir de Aura» en la página de información para salir por completo
  - Las actualizaciones ahora se descargan desde varias fuentes y eligen automáticamente la más rápida (las descargas de GitHub son muy lentas en China continental)
> - v0.6.3:
>   - Renovación visual: nuevos colores semánticos de éxito, advertencia y marca, y todos los contrastes del modo oscuro alcanzan el estándar de accesibilidad 4.5:1.
>   - Tus mensajes usan un fondo azul de marca para distinguirse de las respuestas de la IA; la sesión actual de la barra lateral también se marca con el color de marca.
>   - Las filas de herramientas muestran un punto de color de resultado y el tiempo transcurrido, con un indicador giratorio de marca mientras se ejecutan.
>   - Copia con un clic para mensajes y bloques de código (aparece al pasar el cursor), con confirmación visible.
>   - El clic derecho en la zona de mensajes ya no es un callejón sin salida: copia un mensaje completo o un bloque de código.
>   - Barras de desplazamiento más finas: la interfaz ya no parece una página web.
>   - La posición y el tamaño de la ventana se recuerdan y se restauran al reabrir la aplicación.
>   - F5 / Ctrl+R están interceptados, sin más destellos blancos.
>   - Los borradores de entrada se guardan por conversación, cambiar de sesión no los pierde; pulsa Flecha Arriba en un cuadro vacío para recuperar tu último mensaje.
>   - Contador de tokens en vivo en la esquina inferior derecha del cuadro de entrada.
>   - La barra lateral añade la entrada «Línea de tiempo», y la sección de lista blanca de rutas usa colores de advertencia (las pantallas de v0.6.2 se integran en el mismo lenguaje visual).
> - v0.6.2:
>   - Lista blanca de rutas: autoriza otros directorios para que el modelo lea y escriba. Los directorios del sistema y de claves se rechazan; las carpetas con datos personales requieren confirmación
>   - El mercado admite varias fuentes con filtrado por fuente, y se conecta a la biblioteca de terceros SkillHub
>   - La instalación desde el mercado valida los nombres de herramienta declarados: una habilidad con un error no se puede instalar y se te dice cuál falla
>   - Nueva cronología de operaciones: registra cada paso de una conversación, con búsqueda y exportación a Markdown
>   - El selector de espacio de trabajo se mueve junto al selector de modelo
> - v0.6.1:
>   - La página Skills ya está disponible: muestra el origen, la versión y las herramientas permitidas de cada habilidad, y permite activarlas, desactivarlas o eliminarlas (las integradas y las del espacio de trabajo no se pueden eliminar).
>   - Nuevo mercado de habilidades: instala habilidades del registro oficial con un clic; cada paquete se verifica obligatoriamente con su sha256.
>   - Revisión previa a la instalación: muestra los permisos que pide la habilidad y los patrones de riesgo del paquete (comandos de borrado, acceso a credenciales, inyección de prompts); los hallazgos de alto riesgo requieren una segunda confirmación.
>   - Cualquier repositorio de GitHub puede añadirse como fuente adicional; las habilidades instaladas se actualizan en el sitio y los archivos que hayas añadido al directorio de la habilidad se conservan.
>   - Corregido el fallo constante de «buscar actualizaciones» (el manifiesto de publicación estaba mal formado desde la v0.5.0; no era un problema de red).
> - v0.6.0:
>   - Una vez enviado el primer mensaje de una conversación, su espacio de trabajo ya no se puede cambiar (cada conversación corresponde a exactamente un espacio de trabajo).
>   - Zona de entrada rediseñada: el conmutador de modos y el selector de modelo pasan a estar dentro de la tarjeta de entrada, con un diseño más compacto.
>   - La etiqueta de lenguaje de los bloques de código se movió a la esquina superior izquierda; se añadió resaltado para ini (TOML), Dockerfile, PowerShell, nginx, protobuf y HTTP.
>   - Las claves API ahora se cifran en reposo (Windows DPAPI) en lugar de guardarse en texto plano; tras cambiar de usuario de Windows o reinstalar el sistema habrá que volver a introducirlas.
> - Desde v0.5.0: el modo Chat pasó de acceso total a solo lectura. Tras actualizar, cambia al modo "Build" si quieres que Aura modifique archivos directamente.
> - v0.5.2:
>   - Nuevas entradas en la barra lateral: "Nueva conversación", "Skills" y "MCP"; estas dos últimas están reservadas para funciones futuras.
>   - El plegado y despliegue de la barra lateral ahora usa una animación de transición suave.
>   - El directorio de trabajo se elige al crear una nueva conversación; no se puede enviar mensajes hasta seleccionarlo.
>   - Las conversaciones de un mismo directorio se agrupan automáticamente.
>   - Se corrigió un problema por el que el primer mensaje tras reiniciar podía leer el directorio del espacio de trabajo anterior.
> - v0.5.1:
>   - Se corrigió el congelamiento prolongado de la interfaz al ejecutar comandos con mucha salida (como instalar dependencias o compilar un proyecto).
>   - Ahora se pueden emitir varias llamadas a herramientas en un mismo turno y se ejecutan en orden, sin esperar cada resultado para continuar.
>   - Se corrigió un error de orden por el que las tarjetas de acción aparecían antes del texto principal cuando el modelo "hablaba primero y luego llamaba a herramientas".
>   - Los bloques de código muestran la etiqueta de lenguaje en la esquina superior derecha.
>   - Se corrigió un problema por el que pulsar "Detener" tras cambiar de sesión detenía la tarea de otra sesión.
>   - Se corrigieron dos estilos de advertencia rojos que no tenían efecto.

## Proveedores integrados

| Categoría | Proveedores |
| --- | --- |
| Internacional | OpenRouter, OpenAI, DeepSeek, Moonshot Kimi, Groq, xAI Grok, Together AI |
| China | Zhipu GLM, SiliconFlow, 01.AI Yi, Baichuan, StepFun, MiniMax, Alibaba Bailian Qwen, Volcano Ark Doubao, Tencent Hunyuan |
| Local | Ollama, llama.cpp server |
| Otros | Azure OpenAI, endpoints personalizados compatibles con OpenAI (admite cabeceras de petición personalizadas) |

Todos los proveedores en la nube se conectan mediante el protocolo compatible con OpenAI, con reglas integradas para endpoints que no usan la ruta `/v1`, como DeepSeek, Zhipu GLM y Volcano Ark.

## Capturas de pantalla

### Página de bienvenida

![Página de bienvenida](assets/images/主页面——无对话.png)

### Conversación básica

![Conversación básica](assets/images/基础对话.png)

### Llamadas a herramientas

![Llamada a herramienta 1](assets/images/工具调用1.png)

![Llamada a herramienta 2](assets/images/工具调用2.png)

## Desarrollo

```bash
pnpm install
pnpm tauri dev
```

Depuración solo del frontend:

```bash
pnpm dev
```

## Compilación

```bash
pnpm tauri build
```

## Configuración

Configura en la sección «Servicios de modelos» de la página de ajustes —una tarjeta por proveedor—:

1. Elige el proveedor de modelos (la dirección oficial de la API se rellena automáticamente)
2. Introduce la clave API de ese proveedor
3. Pulsa «Obtener lista de modelos» para descargar los modelos disponibles, y busca y marca los que quieras conservar

Las claves se guardan únicamente en la base de datos SQLite local y se cifran con Windows DPAPI (vinculadas al usuario actual de Windows); nunca se envían a servicios de terceros. Tras cambiar de usuario de Windows o reinstalar el sistema, habrá que volver a introducir la clave de cada proveedor.

Los modelos locales (Ollama / llama.cpp) no necesitan clave API —basta con asegurarse de que el servicio local esté iniciado.

> **Sobre las variables de entorno**: `OPENROUTER_API_KEY` se conserva solo como reserva de compatibilidad histórica para OpenRouter; introduce las claves de los demás proveedores en la página de ajustes.

## Stack tecnológico

- [Tauri 2.0](https://tauri.app) — backend en Rust, ventana e IPC
- React 19 + TypeScript + Vite — frontend
- Tailwind CSS v4 — estilos (tokens del Pinguo Design System)
- rusqlite — almacenamiento local
- reqwest — acceso HTTP multiproveedor

## Licencia

Este proyecto es de código abierto bajo la [Apache License 2.0](LICENSE).
