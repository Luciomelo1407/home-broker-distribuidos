'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ErroApi } from '../api/rest';
import { salvarSessao } from '../lib/sessao';

interface Props {
  modo: 'login' | 'cadastro';
}

/** Login (RF-002) e cadastro (RF-001): o cadastro já entra em seguida. */
export function FormularioCredenciais({ modo }: Props) {
  const router = useRouter();
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(undefined);
    setEnviando(true);
    try {
      if (modo === 'cadastro') await api.cadastrar(nomeUsuario, senha);
      const login = await api.entrar(nomeUsuario, senha);
      salvarSessao(login);
      router.replace('/painel/');
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'erro inesperado');
    } finally {
      setEnviando(false);
    }
  }

  const titulo = modo === 'login' ? 'Entrar' : 'Criar conta';
  return (
    <main className="tela-acesso">
      <form className="cartao acesso" onSubmit={(e) => void enviar(e)}>
        <h1>Simulador de Bolsa</h1>
        <h2>{titulo}</h2>
        <label>
          Usuário
          <input
            value={nomeUsuario}
            onChange={(e) => setNomeUsuario(e.target.value)}
            autoComplete="username"
            minLength={3}
            maxLength={50}
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            maxLength={100}
            required
          />
        </label>
        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Aguarde…' : titulo}
        </button>
        {modo === 'login' ? (
          <p>
            Não tem conta? <Link href="/cadastro/">Cadastre-se</Link>
          </p>
        ) : (
          <p>
            Já tem conta? <Link href="/login/">Entrar</Link>
          </p>
        )}
      </form>
    </main>
  );
}
