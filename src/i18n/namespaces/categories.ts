import { defineNamespace } from "../types.ts";

/** Tela de categorias do painel + aviso de catálogo inexistente. */
export const categories = defineNamespace({
  ptBR: {
    title: "Categorias",
    subtitle: "Organize seus produtos em grupos, como “Agendas” ou “Papelaria”.",
    namePlaceholder: "Nome da categoria",
    add: "Adicionar categoria",
    empty: "Nenhuma categoria ainda.",
    moveUp: "Subir",
    moveDown: "Descer",
    delete: "Excluir",
    errors: {
      createFailed: "Não foi possível criar a categoria.",
      deleteFailed: "Erro ao excluir.",
    },
    emptyCatalog: "Crie seu catálogo na aba Início antes de continuar.",
  },
  en: {
    title: "Categories",
    subtitle: "Group your products, such as “Planners” or “Stationery”.",
    namePlaceholder: "Category name",
    add: "Add category",
    empty: "No categories yet.",
    moveUp: "Move up",
    moveDown: "Move down",
    delete: "Delete",
    errors: {
      createFailed: "Could not create the category.",
      deleteFailed: "Could not delete.",
    },
    emptyCatalog: "Create your catalog in the Home tab before continuing.",
  },
  es: {
    title: "Categorías",
    subtitle: "Organiza tus productos en grupos, como “Agendas” o “Papelería”.",
    namePlaceholder: "Nombre de la categoría",
    add: "Agregar categoría",
    empty: "Todavía no hay categorías.",
    moveUp: "Subir",
    moveDown: "Bajar",
    delete: "Eliminar",
    errors: {
      createFailed: "No se pudo crear la categoría.",
      deleteFailed: "No se pudo eliminar.",
    },
    emptyCatalog: "Crea tu catálogo en la pestaña Inicio antes de continuar.",
  },
});
