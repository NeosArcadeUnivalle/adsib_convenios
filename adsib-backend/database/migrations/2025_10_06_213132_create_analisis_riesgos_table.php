<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('analisis_riesgos', function (Blueprint $table) {
            $table->id();

            // FK al convenio
            $table->foreignId('convenio_id')
                ->constrained('convenios')
                ->cascadeOnDelete();

            // FK a la versión del convenio (tu tabla se llama versiones_convenio)
            $table->foreignId('version_id')
                ->nullable()
                ->constrained('versiones_convenio')   // <<--- nombre correcto
                ->nullOnDelete();

            // Resultado del análisis
            $table->enum('risk_level', ['ALTO','MEDIO','BAJO'])->index();
            $table->decimal('score', 5, 4)->default(0);     // 0..1
            $table->json('matches')->nullable();            // hallazgos (tokens, pag/linea, severidad, etc.)

            // Metadatos opcionales
            $table->string('modelo')->nullable();           // ej: "nlp-risk-service@1.2"
            $table->timestampTz('analizado_en')->nullable();

            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('analisis_riesgos');
    }
};