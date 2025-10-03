<?php

namespace App\Http\Controllers;

use App\Services\NlpRiskClient;
use Illuminate\Http\Request;

class NlpController extends Controller
{
    public function analyze(Request $req, NlpRiskClient $nlp)
    {
        $data = $req->validate([
            'text' => ['required', 'string', 'min:3']
        ]);

        $result = $nlp->analyze($data['text']);
        return response()->json($result);
    }
}