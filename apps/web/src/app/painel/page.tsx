'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Painel } from '../../components/painel';
import { CHAVE_SESSAO, encerrarSessao, lerSessao, type Sessao } from '../../lib/sessao';

export default function PaginaPainel() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>();

  useEffect(() => {
    const atual = lerSessao();
    if (!atual) router.replace('/login/');
    setSessao(atual ?? null);
    const sincronizar = (evento: StorageEvent) => {
      if (evento.key !== CHAVE_SESSAO && evento.key !== null) return;
      const nova = lerSessao();
      setSessao(nova ?? null);
      if (!nova) router.replace('/login/');
    };
    window.addEventListener('storage', sincronizar);
    return () => window.removeEventListener('storage', sincronizar);
  }, [router]);

  const sair = useCallback(() => {
    setSessao(null);
    encerrarSessao();
    router.replace('/login/');
  }, [router]);

  if (!sessao) return null;
  return <Painel key={sessao.token} sessao={sessao} aoSair={sair} />;
}
