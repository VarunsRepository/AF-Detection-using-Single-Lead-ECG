


import types

def mutate_and_run_dsp(func, signal, sampling_rate, user_slider_updates):
    """
    Acts like DNA Polymerase I: Re-synthesizes the function's bytecode 
    in memory, replacing old constant tuning values with new slider values.
    """
    # 1. Extract the current structural DNA of the function
    original_code = func.__code__
    original_constants = list(original_code.co_consts)
    
    # Mapping table: Match your function's internal hardcoded numbers to user sliders
    # Look closely at your original code values:
    # 5.0 (low pass), 15.0 (high pass), 0.15 (MWI window), 1.8 (threshold multiplier)
    value_to_slider_map = {
        5.0: "low_cutoff",
        15.0: "high_cutoff",
        0.15: "mwi_window_sec",
        1.8: "threshold_multiplier"
    }
    
    # 2. Mutate the Constants array (Splice in the new slider values)
    mutated_constants = []
    for constant in original_constants:
        if constant in value_to_slider_map:
            slider_name = value_to_slider_map[constant]
            # If the user changed this slider, insert their new value!
            if slider_name in user_slider_updates:
                mutated_constants.append(user_slider_updates[slider_name])
                continue
        mutated_constants.append(constant)
        
    # 3. Clone and assemble the new mutated Code Object
    # We copy the exact structure but inject our modified constants tuple
    mutated_code = original_code.replace(co_consts=tuple(mutated_constants))
    
    # 4. Birth the cloned function into existence
    mutated_function = types.FunctionType(
        mutated_code, 
        func.__globals__, 
        name=func.__name__, 
        argdefs=func.__defaults__, 
        closure=func.__closure__
    )
    
    # 5. Execute the mutated algorithm block on your signal data
    return mutated_function(signal, sampling_rate)
