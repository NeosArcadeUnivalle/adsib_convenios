<?php

declare(strict_types=1);

namespace App\Services\Assistant;

use Illuminate\Support\Facades\Http;

class OllamaClient
{
    protected string $base;
    protected string $model;
    protected int $timeout;

    public function __construct()
    {
        // Mantén compatibilidad con tus variables antiguas
        $this->base    = rtrim(env('OLLAMA_URL', env('OLLAMA_BASE', 'http://127.0.0.1:11434')), '/');
        $this->model   = env('OLLAMA_MODEL', 'llama3');
        $this->timeout = (int) env('OLLAMA_TIMEOUT', 45);
    }

    /**
     * Generación simple (endpoint /api/generate), igual que tu cliente antiguo.
     */
    public function generate(string $prompt): string
    {
        $payload = [
            'model'  => $this->model,
            'prompt' => $prompt,
            'stream' => false,
        ];

        $resp = Http::timeout($this->timeout)
            ->withoutVerifying()
            ->post("{$this->base}/api/generate", $payload);

        if (!$resp->successful()) {
            throw new \RuntimeException('Ollama error: '.$resp->body());
        }

        $json = $resp->json();
        return $json['response'] ?? 'No se pudo generar respuesta.';
    }

    /**
     * Opcional: chat (endpoint /api/chat) para futuras mejoras.
     */
    public function chat(array $messages, array $options = []): string
    {
        $payload = [
            'model'    => $this->model,
            'messages' => $messages,
            'options'  => $options,
            'stream'   => false,
        ];

        $resp = Http::timeout($this->timeout)
            ->withoutVerifying()
            ->post("{$this->base}/api/chat", $payload);

        if (!$resp->successful()) {
            throw new \RuntimeException('Ollama chat error: '.$resp->body());
        }

        $json = $resp->json();
        // Algunos servidores devuelven {message:{content:...}}, otros {response:...}
        return $json['message']['content'] ?? ($json['response'] ?? 'No se pudo generar respuesta.');
    }
}