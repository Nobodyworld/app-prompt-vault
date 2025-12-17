export type Locale = "en" | "es";

export type TranslationValue =
  | string
  | ((params: Record<string, string | number | undefined>) => string);

export type Translations = Record<string, TranslationValue>;

export const en = {
  "app.title": "Prompt Vault",

  "nav.library": "Library",
  "nav.create": "Create",

  "sidebar.settings": "Settings",
  "sidebar.profile": "Profile",

  "window.minimize": "Minimize",
  "window.close": "Close",

  "banner.offline":
    "Offline / demo mode — using local fallback data. Changes will be synced when the server is available.",

  "library.loading": "Loading prompts...",
  "library.failedLoad": "Failed to load prompts",
  "library.search.placeholder":
    "Search prompts... (Ctrl+K to focus, Esc to clear)",
  "library.search.clear": "Clear search",
  "library.search.tagPlaceholder": "Filter by tag (exact match)",
  "library.search.categoryPlaceholder": "Filter by category (exact match)",
  "library.search.projectTagIdPlaceholder": "Filter by projectTagId (UUID)",
  "library.search.searching": "Searching...",
  "library.search.noMatches": "No prompts match your search.",
  "library.search.found": ({ count }) =>
    `Found ${count} prompt${count === 1 ? "" : "s"}`,

  "library.toast.bodyUnavailable":
    "Prompt body is unavailable. Try opening the editor to refresh this entry.",
  "library.toast.searchFallback":
    "Search is temporarily unavailable. Showing local results.",
  "library.toast.copied": "Prompt copied to clipboard!",
  "library.toast.clipboardBlocked":
    "Clipboard access blocked. Try using Ctrl+C/Cmd+C to copy manually, or enable clipboard permissions in your browser settings.",
  "library.toast.fallbackCopyFailed":
    "Automatic copying failed. The prompt text has been displayed in an alert - please copy it manually.",
  "library.toast.manualCopyRequired":
    "Prompt text displayed in alert popup. Please copy it manually using Ctrl+C/Cmd+C.",
  "library.toast.exportButtonsMissing":
    "Add prompts with bodies to export a switchboard.",
  "library.toast.exportPlannerMissing":
    "No prompts available to stage planner tasks.",
  "library.toast.buttonsCopied": "Buttons switchboard JSON copied",
  "library.toast.plannerCopied": "Planner bucket draft copied",

  "interop.title": "Reuse these prompts elsewhere",
  "interop.eyebrow": "Send to other apps",
  "interop.description":
    "Copy JSON payloads that drop directly into Buttons (floating switchboard) or Planner (bucket draft).",
  "interop.selected": ({ count }) => `${count} selected`,
  "interop.phrases": ({ count }) => `${count} phrases`,
  "interop.copyButtons": "Copy Buttons switchboard JSON",
  "interop.copyPlanner": "Copy Planner bucket draft",
  "interop.copyButtons.title": "Copy a Buttons-compatible switchboard button",
  "interop.copyPlanner.title":
    "Copy a Planner bucket draft with tasks seeded from these prompts",

  "bundle.eyebrow": "Marketplace packaging",
  "bundle.title": "Prompt bundles",
  "bundle.description":
    "Export the current results as a JSON/YAML bundle, or paste a bundle to import it.",
  "bundle.exportJson": "Copy bundle (JSON)",
  "bundle.exportYaml": "Copy bundle (YAML)",
  "bundle.importPlaceholder": "Paste bundle JSON or YAML here",
  "bundle.importJson": "Import bundle (JSON)",
  "bundle.importYaml": "Import bundle (YAML)",

  "bundle.toast.exportCopied": "Bundle copied to clipboard!",
  "bundle.toast.exportFailed": "Failed to export bundle",
  "bundle.toast.importMissing": "Paste a bundle first.",
  "bundle.toast.importFailed": "Failed to import bundle",
  "bundle.toast.imported": ({ count }) =>
    `Imported ${count} prompt${count === 1 ? "" : "s"}`,

  "create.title": "Create Prompt",
  "create.runtimeUnavailable":
    "Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompts.",
  "create.bodyRequired": "Prompt body is required.",
  "create.untitled": "Untitled Prompt",
  "create.ratingInvalid":
    "Rating must be a whole number from 1 to 5 (or empty).",
  "create.success": "Prompt created successfully!",
  "create.failed": "Failed to create prompt",
  "create.promptMessage": "Prompt Message",
  "create.promptMessage.placeholder":
    "Paste or write your reusable prompt here",
  "create.category": "Category (optional)",
  "create.category.placeholder": "e.g., Writing, Coding, Business",
  "create.favorite": "Favorite",
  "create.rating": "Rating (optional, 1-5)",
  "create.rating.placeholder": "1..5",
  "create.quickTags": "Quick Tags",
  "create.customTags": "Custom Tags (optional)",
  "create.customTags.placeholder": "Add comma separated labels",
  "create.meta.slug": "Slug",
  "create.meta.version": "Version",
  "create.meta.tags": "Tags",
  "actions.cancel": "Cancel",
  "actions.clear": "Clear",
  "actions.create": "Create Prompt",
  "actions.creating": "Creating...",
  "actions.clearConfirm": "Are you sure you want to clear the form?",
  "create.warning.runtimeUnavailable":
    "Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompts locally.",

  "edit.missingContext":
    "Select a prompt from the library to edit. The editor needs the prompt context passed from the list.",
  "edit.title": "Edit Prompt",
  "edit.subtitle":
    "Updating this prompt creates a new version. Older versions remain in the history.",
  "edit.runtimeUnavailable":
    "Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save changes.",
  "edit.bodyEmpty": "Prompt body cannot be empty.",
  "edit.failed": "Failed to save a new prompt version.",
  "edit.label.title": "Title",
  "edit.title.placeholder": "Prompt title",
  "edit.label.category": "Category (optional)",
  "edit.label.favorite": "Favorite",
  "edit.label.rating": "Rating (optional, 1-5)",
  "edit.label.body": "Prompt Body",
  "edit.body.placeholder": "Update the prompt instructions",
  "edit.label.changelog": "Changelog (optional)",
  "edit.changelog.placeholder": "Describe what changed in this version",
  "edit.meta.id": "ID",
  "edit.meta.currentVersion": "Current Version",
  "edit.label.newVersion": "New Semantic Version",
  "edit.newVersion.placeholder": "e.g., 1.0.1",
  "actions.save": "Save Version",
  "actions.saving": "Saving...",
  "edit.warning.runtimeUnavailable":
    "Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompt changes.",
} satisfies Translations;

export type TranslationKey = keyof typeof en;

export const es: Record<TranslationKey, TranslationValue> = {
  "app.title": "Bóveda de Prompts",

  "nav.library": "Biblioteca",
  "nav.create": "Crear",

  "sidebar.settings": "Ajustes",
  "sidebar.profile": "Perfil",

  "window.minimize": "Minimizar",
  "window.close": "Cerrar",

  "banner.offline":
    "Sin conexión / modo demo — usando datos locales. Los cambios se sincronizarán cuando el servidor esté disponible.",

  "library.loading": "Cargando prompts...",
  "library.failedLoad": "No se pudieron cargar los prompts",
  "library.search.placeholder":
    "Buscar prompts... (Ctrl+K para enfocar, Esc para limpiar)",
  "library.search.clear": "Limpiar búsqueda",
  "library.search.tagPlaceholder": "Filtrar por etiqueta (coincidencia exacta)",
  "library.search.categoryPlaceholder":
    "Filtrar por categoría (coincidencia exacta)",
  "library.search.projectTagIdPlaceholder": "Filtrar por projectTagId (UUID)",
  "library.search.searching": "Buscando...",
  "library.search.noMatches": "Ningún prompt coincide con tu búsqueda.",
  "library.search.found": ({ count }) =>
    `Se encontraron ${count} prompt${count === 1 ? "" : "s"}`,

  "library.toast.bodyUnavailable":
    "El contenido del prompt no está disponible. Abre el editor para refrescar esta entrada.",
  "library.toast.searchFallback":
    "La búsqueda no está disponible temporalmente. Mostrando resultados locales.",
  "library.toast.copied": "¡Prompt copiado al portapapeles!",
  "library.toast.clipboardBlocked":
    "Acceso al portapapeles bloqueado. Usa Ctrl+C/Cmd+C para copiar manualmente o habilita permisos de portapapeles en el navegador.",
  "library.toast.fallbackCopyFailed":
    "Falló la copia automática. El texto se mostró en una alerta: cópialo manualmente.",
  "library.toast.manualCopyRequired":
    "Texto del prompt mostrado en una alerta. Cópialo manualmente con Ctrl+C/Cmd+C.",
  "library.toast.exportButtonsMissing":
    "Agrega prompts con contenido para exportar un tablero.",
  "library.toast.exportPlannerMissing":
    "No hay prompts disponibles para preparar tareas del Planner.",
  "library.toast.buttonsCopied": "JSON del tablero de Buttons copiado",
  "library.toast.plannerCopied": "Borrador de cubeta del Planner copiado",

  "interop.title": "Reutiliza estos prompts en otros lugares",
  "interop.eyebrow": "Enviar a otras apps",
  "interop.description":
    "Copia payloads JSON que funcionan directamente en Buttons (tablero flotante) o Planner (borrador de cubeta).",
  "interop.selected": ({ count }) => `${count} seleccionados`,
  "interop.phrases": ({ count }) => `${count} frases`,
  "interop.copyButtons": "Copiar JSON del tablero de Buttons",
  "interop.copyPlanner": "Copiar borrador de cubeta del Planner",
  "interop.copyButtons.title": "Copia un tablero compatible con Buttons",
  "interop.copyPlanner.title":
    "Copia un borrador de cubeta con tareas generadas desde estos prompts",

  "bundle.eyebrow": "Empaquetado para Marketplace",
  "bundle.title": "Paquetes de prompts",
  "bundle.description":
    "Exporta los resultados actuales como un paquete JSON/YAML, o pega un paquete para importarlo.",
  "bundle.exportJson": "Copiar paquete (JSON)",
  "bundle.exportYaml": "Copiar paquete (YAML)",
  "bundle.importPlaceholder": "Pega aquí el paquete JSON o YAML",
  "bundle.importJson": "Importar paquete (JSON)",
  "bundle.importYaml": "Importar paquete (YAML)",

  "bundle.toast.exportCopied": "¡Paquete copiado al portapapeles!",
  "bundle.toast.exportFailed": "No se pudo exportar el paquete",
  "bundle.toast.importMissing": "Primero pega un paquete.",
  "bundle.toast.importFailed": "No se pudo importar el paquete",
  "bundle.toast.imported": ({ count }) =>
    `Se importaron ${count} prompt${count === 1 ? "" : "s"}`,

  "create.title": "Crear prompt",
  "create.runtimeUnavailable":
    "Runtime de escritorio no disponible. Abre Prompt Vault desde la app de escritorio para guardar prompts.",
  "create.bodyRequired": "Se requiere el contenido del prompt.",
  "create.untitled": "Prompt sin título",
  "create.ratingInvalid":
    "La calificación debe ser un número entero del 1 al 5 (o vacío).",
  "create.success": "¡Prompt creado correctamente!",
  "create.failed": "No se pudo crear el prompt",
  "create.promptMessage": "Mensaje del prompt",
  "create.promptMessage.placeholder":
    "Pega o escribe aquí tu prompt reutilizable",
  "create.category": "Categoría (opcional)",
  "create.category.placeholder": "p. ej., Escritura, Código, Negocio",
  "create.favorite": "Favorito",
  "create.rating": "Calificación (opcional, 1-5)",
  "create.rating.placeholder": "1..5",
  "create.quickTags": "Etiquetas rápidas",
  "create.customTags": "Etiquetas personalizadas (opcional)",
  "create.customTags.placeholder": "Agrega etiquetas separadas por comas",
  "create.meta.slug": "Slug",
  "create.meta.version": "Versión",
  "create.meta.tags": "Etiquetas",
  "actions.cancel": "Cancelar",
  "actions.clear": "Limpiar",
  "actions.create": "Crear prompt",
  "actions.creating": "Creando...",
  "actions.clearConfirm": "¿Seguro que quieres limpiar el formulario?",
  "create.warning.runtimeUnavailable":
    "Runtime de escritorio no disponible. Abre Prompt Vault desde la app de escritorio para guardar prompts localmente.",

  "edit.missingContext":
    "Selecciona un prompt de la biblioteca para editar. El editor necesita el contexto del prompt desde la lista.",
  "edit.title": "Editar prompt",
  "edit.subtitle":
    "Actualizar este prompt crea una nueva versión. Las versiones anteriores permanecen en el historial.",
  "edit.runtimeUnavailable":
    "Runtime de escritorio no disponible. Abre Prompt Vault desde la app de escritorio para guardar cambios.",
  "edit.bodyEmpty": "El contenido del prompt no puede estar vacío.",
  "edit.failed": "No se pudo guardar una nueva versión del prompt.",
  "edit.label.title": "Título",
  "edit.title.placeholder": "Título del prompt",
  "edit.label.category": "Categoría (opcional)",
  "edit.label.favorite": "Favorito",
  "edit.label.rating": "Calificación (opcional, 1-5)",
  "edit.label.body": "Contenido del prompt",
  "edit.body.placeholder": "Actualiza las instrucciones del prompt",
  "edit.label.changelog": "Registro de cambios (opcional)",
  "edit.changelog.placeholder": "Describe qué cambió en esta versión",
  "edit.meta.id": "ID",
  "edit.meta.currentVersion": "Versión actual",
  "edit.label.newVersion": "Nueva versión semántica",
  "edit.newVersion.placeholder": "p. ej., 1.0.1",
  "actions.save": "Guardar versión",
  "actions.saving": "Guardando...",
  "edit.warning.runtimeUnavailable":
    "Runtime de escritorio no disponible. Abre Prompt Vault desde la app de escritorio para guardar cambios.",
};

export const translations: Record<
  Locale,
  Record<TranslationKey, TranslationValue>
> = {
  en,
  es,
};
