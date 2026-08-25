import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Carrinho(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8" cy="21" r="1.5" />
      <circle cx="18" cy="21" r="1.5" />
      <path d="M2.5 3h3l1.5 9h12l2-6H7" />
    </svg>
  );
}

function Sacola(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 3h12l1.5 17H4.5L6 3Z" />
      <path d="M9 3V1a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function SacolaCoracao(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 3h12l1.5 17H4.5L6 3Z" />
      <path d="M9 3V1a3 3 0 0 1 6 0v2" />
      <path d="M12 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Z" fill="currentColor" strokeWidth="0" />
      <path d="M12 13l-.7.7A1.5 1.5 0 0 1 9 12.5 1.5 1.5 0 0 1 12 11a1.5 1.5 0 0 1 3 2.5 1.5 1.5 0 0 1-2.3 1.2L12 13Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CarrinhoCoracao(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8" cy="21" r="1.5" />
      <circle cx="18" cy="21" r="1.5" />
      <path d="M2.5 3h3l1.5 9h12l2-6H7" />
      <path d="M13 8c1.1 0 2 .9 2 2s-1.6 1.8-2 2c-.4-.2-2-.8-2-2s.9-2 2-2Z" fill="currentColor" stroke="none" />
      <path d="M13 10l-.5.5A1 1 0 0 1 11 10a1 1 0 0 1 2 0 1 1 0 0 1-1.5.5L13 10Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Minimalista(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7h16l-1.5 11H5.5L4 7Z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

function Kawaii(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 3h12l1.5 17H4.5L6 3Z" />
      <path d="M9 3V1a3 3 0 0 1 6 0v2" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="0.8" fill="currentColor" stroke="none" />
      <path d="M10.5 16.5c.6.7 1.4 1 1.5 1s.9-.3 1.5-1" strokeWidth="1.4" />
    </svg>
  );
}

export const CART_STYLES = [
  { key: "carrinho", label: "Carrinho", Icon: Carrinho },
  { key: "sacola", label: "Sacola", Icon: Sacola },
  { key: "sacola_coracao", label: "Sacola com coração", Icon: SacolaCoracao },
  { key: "carrinho_coracao", label: "Carrinho com coração", Icon: CarrinhoCoracao },
  { key: "minimalista", label: "Minimalista", Icon: Minimalista },
  { key: "kawaii", label: "Kawaii", Icon: Kawaii },
] as const;

export function CartIcon({ style, ...props }: { style: string } & Props) {
  const entry = CART_STYLES.find((c) => c.key === style) ?? CART_STYLES[0];
  return <entry.Icon {...props} />;
}
