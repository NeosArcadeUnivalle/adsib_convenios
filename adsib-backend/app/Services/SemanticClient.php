<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class SemanticClient
{
    protected string $baseUrl;
    protected int $timeout;

    public function __construct()
    {
        $this->baseUrl = rtrim(env('SEMANTIC_URL', 'http://127.0.0.1:8010'), '/');
        $this->timeout = (int) env('SEMANTIC_TIMEOUT', 25);
    }

    /**
     * Envía un lote de fragmentos para indexar.
     * items: [
     *   ['convenio_id'=>1,'version_id'=>2,'fragmento'=>'texto', 'meta'=>['fuente'=>'db']]
     * ]
     */
    public function index(array $items): array
    {
        $resp = Http::timeout($this->timeout)
            ->post("{$this->baseUrl}/index", ['items' => $items]);

        if (!$resp->ok()) {
            throw new \RuntimeException("Semantic index error {$resp->status()}: ".$resp->body());
        }
        return (array) $resp->json();
    }

    /**
     * Búsqueda semántica.
     * @param string $query
     * @param int    $k
     * @param int|null $convenioId  (opcional)
     */
    public function search(string $query, int $k = 5, ?int $convenioId = null): array
    {
        $payload = ['query'=>$query, 'k'=>$k];
        if ($convenioId) $payload['convenio_id'] = $convenioId;

        $resp = Http::timeout($this->timeout)
            ->post("{$this->baseUrl}/search", $payload);

        if (!$resp->ok()) {
            throw new \RuntimeException("Semantic search error {$resp->status()}: ".$resp->body());
        }
        return (array) $resp->json();
    }

    /** Salud del servicio */
    public function health(): array
    {
        $resp = Http::timeout(8)->get("{$this->baseUrl}/health");
        if (!$resp->ok()) {
            throw new \RuntimeException("Semantic health error {$resp->status()}: ".$resp->body());
        }
        return (array) $resp->json();
    }
}