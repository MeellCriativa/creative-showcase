import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Catalog, Category, Product } from "@/lib/catalog";

export function useMyCatalog(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-catalog", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogs")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Catalog | null) ?? null;
    },
  });
}

export function useCategories(catalogId: string | undefined) {
  return useQuery({
    queryKey: ["categories", catalogId],
    enabled: !!catalogId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("catalog_id", catalogId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

export function useProducts(catalogId: string | undefined) {
  return useQuery({
    queryKey: ["products", catalogId],
    enabled: !!catalogId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("catalog_id", catalogId!)
        .order("position")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });
}
