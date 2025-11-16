<?php
namespace App\Http\Controllers;

use App\Models\Usuario;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use App\Http\Requests\UsuarioStoreRequest;
use App\Http\Requests\UsuarioUpdateRequest;

class UsuarioController extends Controller
{
    // GET /api/usuarios?q=...&per_page=10
    public function index(Request $r) {
        $per = (int)($r->get('per_page', 5));
        $per = ($per > 0 && $per <= 100) ? $per : 10;

        $q = Usuario::query()
            ->when($r->filled('q'), function($qq) use ($r){
                $t = '%'.strtolower($r->q).'%';
                $qq->whereRaw('LOWER(nombre) LIKE ?', [$t])
                   ->orWhereRaw('LOWER(email) LIKE ?', [$t]);
            })
            ->orderBy('created_at','desc');

        return response()->json($q->paginate($per));
    }

    public function show($id) {
        return response()->json(Usuario::findOrFail($id));
    }

    public function store(UsuarioStoreRequest $r) {
        $data = $r->validated();
        $data['password'] = Hash::make($data['password']);
        $u = Usuario::create($data);
        return response()->json($u, 201);
    }

    public function update(UsuarioUpdateRequest $r, $id) {
        $u = Usuario::findOrFail($id);
        $data = $r->validated();
        if (isset($data['password']) && $data['password']) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }
        $u->update($data);
        return response()->json($u);
    }

    public function destroy($id) {
        $u = Usuario::findOrFail($id);
        if (auth()->id() === (int)$id) return response()->json(['message'=>'No puedes eliminar tu propia cuenta'], 422);
        $u->delete();
        return response()->json(['ok'=>true]);
    }
}