<?php

namespace App\Services\Assistant;

use Illuminate\Support\Facades\Http;

class OllamaClient
{
    protected string $base;
    protected string $model;

    public function __construct()
    {
        $this->base  = env('OLLAMA_BASE', 'http://localhost:11434');
        $this->model = env('OLLAMA_MODEL', 'llama3');
    }

    public function generate(string $prompt): string
    {
        $payload = [
            'model'  => $this->model,
            'prompt' => $prompt,
            'stream' => false,
        ];

        $resp = Http::post("{$this->base}/api/generate", $payload);

        if (!$resp->successful()) {
            throw new \RuntimeException('Ollama error: '.$resp->body());
        }
        $json = $resp->json();
        return $json['response'] ?? 'No se pudo generar respuesta.';
    }
}