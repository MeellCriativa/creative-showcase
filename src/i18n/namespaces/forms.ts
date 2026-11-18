import { defineNamespace } from "../types.ts";

/** Textos de componentes de formulário compartilhados entre as telas. */
export const forms = defineNamespace({
  ptBR: {
    uploader: {
      addLabel: "Adicionar foto",
      uploadedAlt: "Imagem enviada",
      remove: "Remover imagem",
      uploadFailed: "Não foi possível enviar a imagem.",
    },
    currencyPicker: {
      dialogTitle: "Escolher moeda",
      close: "Fechar",
      searchPlaceholder: "Nome, código (ISO) ou país",
      results: {
        one: "{{count}} de {{total}} moeda",
        other: "{{count}} de {{total}} moedas",
      },
      empty: "Nenhuma moeda encontrada.",
      international: "Internacional",
      noRate: "sem cotação agora",
    },
  },
  en: {
    uploader: {
      addLabel: "Add photo",
      uploadedAlt: "Uploaded image",
      remove: "Remove image",
      uploadFailed: "Could not upload the image.",
    },
    currencyPicker: {
      dialogTitle: "Choose currency",
      close: "Close",
      searchPlaceholder: "Name, code (ISO) or country",
      results: {
        one: "{{count}} of {{total}} currency",
        other: "{{count}} of {{total}} currencies",
      },
      empty: "No currency found.",
      international: "International",
      noRate: "no rate right now",
    },
  },
  es: {
    uploader: {
      addLabel: "Agregar foto",
      uploadedAlt: "Imagen subida",
      remove: "Quitar imagen",
      uploadFailed: "No se pudo subir la imagen.",
    },
    currencyPicker: {
      dialogTitle: "Elegir moneda",
      close: "Cerrar",
      searchPlaceholder: "Nombre, código (ISO) o país",
      results: {
        one: "{{count}} de {{total}} moneda",
        other: "{{count}} de {{total}} monedas",
      },
      empty: "No se encontró ninguna moneda.",
      international: "Internacional",
      noRate: "sin cotización ahora",
    },
  },
});
