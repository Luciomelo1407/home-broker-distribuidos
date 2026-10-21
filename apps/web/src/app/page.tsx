'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { lerSessao } from '../lib/sessao';

/** Entrada: quem já tem sessão vai direto ao painel (RF-004). */
export default function Inicio() {
  const router = useRouter();
  useEffect(() => {
    router.replace(lerSessao() ? '/painel/' : '/login/');
  }, [router]);
  return null;
}
