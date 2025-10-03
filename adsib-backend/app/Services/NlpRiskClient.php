<?php

namespace App\Services;

use GuzzleHttp\Client;

class NlpRiskClient
{
    protected Client $http;
    protected string $base;

    public function __construct()
    {
        $this->base = config('services.nlp_risk.base_url');
        $this->http = new Client([
            'base_uri' => rtrim($this->base, '/') . '/',
            'timeout'  => 10,
        ]);
    }

    public function analyze(string $text): array
    {
        $res = $this->http->post('analyze', [
            'json' => ['text' => $text],
        ]);
        return json_decode((string) $res->getBody(), true);
    }
}