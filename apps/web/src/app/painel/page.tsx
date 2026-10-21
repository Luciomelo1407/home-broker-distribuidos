'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Painel } from '../../components/painel';
import { encerrarSessao, lerSessao, type Sessao } from '../../lib/sessao';

export default function PaginaPainel() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>();

  useEffect(() => {
    const atual = lerSessao();
    if (!atual) router.replace('/login/');
    setSessao(atual ?? null);
  }, [router]);

  const sair = useCallback(() => {
    encerrarSessao();
    router.replace('/login/');
  }, [router]);

  if (!sessao) return null;
  return <Painel sessao={sessao} aoSair={sair} />;
}
